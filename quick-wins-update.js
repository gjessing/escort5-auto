#!/usr/bin/env node

/**
 * quick-wins-update.js (MULTI-SITE)
 * Updates escort5.dk AND escort.se article titles/meta
 * Handles both sites - auto-detects from env var SITE_URL
 */

import 'dotenv/config';
import { chromium } from 'playwright';
import minimist from 'minimist';

const args = minimist(process.argv.slice(2));
const KEYWORD = args.keyword || null;
const SITE = args.site || null; // 'dk' or 'se'
const DRY_RUN = args['dry-run'] === true || args.dry === true;
const HEADLESS = args.headless !== false;

const { LOGIN_URL, ADMIN_URL, USERNAME, PASSWORD, SITE_URL } = process.env;

if (!LOGIN_URL || !ADMIN_URL || !USERNAME || !PASSWORD) {
  console.error('❌ Missing env vars: LOGIN_URL, ADMIN_URL, USERNAME, PASSWORD');
  process.exit(1);
}

// Detect site from SITE_URL or args
const detectedSite = SITE || (SITE_URL?.includes('.se') ? 'se' : 'dk');

/**
 * Quick Wins for escort5.dk
 */
const QUICK_WINS_DK = [
  {
    keyword: "eskortepiger",
    article: "Escort Piger - Find Danmarks Bedste Escorts",
    title: "Escortpiger i Danmark - Køb Escort Online",
    meta: "Find escortpiger i Danmark. Diskret møde, professionel service. Book direkte online. Samme dag levering til hele landet.",
  },
];

/**
 * Quick Wins for escort.se
 */
const QUICK_WINS_SE = [
  {
    keyword: "eskort guide",
    article: "Eskort Guide Sverige",
    title: "Eskort Guide Sverige - Hitta Escorttjej Online",
    meta: "Eskort guide för Sverige. Hitta perfekt eskorttjej. Diskret bokring, professionell service. Alla regioner. Klicka här!",
  },
  {
    keyword: "sex tjejer i örebro",
    article: "Sex Tjejer Örebro",
    title: "Sex Tjejer Örebro - Book Direkt Online Nu",
    meta: "Sex tjejer i Örebro ready now! Diskret möte, professionell service. Many girls available. Book online instantly!",
  },
];

const QUICK_WINS = detectedSite === 'se' ? QUICK_WINS_SE : QUICK_WINS_DK;

async function updateKeyword(page, keyword, articleTitle, newTitle, newMeta) {
  console.log(`\n📝 Updating keyword: "${keyword}"`);
  console.log(`   Article: "${articleTitle}"`);
  
  // Gå til AdminTopics
  console.log("   Navigating to AdminTopics...");
  await page.goto(ADMIN_URL, { waitUntil: 'networkidle' });
  
  // Find artiklen i listen
  const items = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('li.rlbItem')).map(el => {
      const tekst = (el.textContent || '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
      return tekst;
    });
  });
  
  // Find best match
  let bestMatch = null;
  let bestScore = 0;
  
  for (const item of items) {
    const itemLower = item.toLowerCase();
    const searchLower = articleTitle.toLowerCase();
    
    let score = 0;
    if (itemLower.includes(searchLower)) score = 100;
    else if (itemLower.split(' ').some(w => searchLower.includes(w) && w.length > 3)) score = 50;
    else if (itemLower.includes(articleTitle.split(' ')[0].toLowerCase())) score = 25;
    
    if (score > bestScore) {
      bestScore = score;
      bestMatch = item;
    }
  }
  
  if (!bestMatch) {
    console.log(`   ❌ Article not found`);
    return false;
  }
  
  console.log(`   ✅ Found: "${bestMatch.substring(0, 60)}"`);
  
  // Klik på artiklen
  const allItems = await page.locator('li.rlbItem').all();
  let found = false;
  
  for (const item of allItems) {
    const text = await item.textContent();
    if (text.includes(bestMatch.substring(0, 30))) {
      await item.click();
      found = true;
      break;
    }
  }
  
  if (!found) {
    console.log(`   ❌ Could not click article`);
    return false;
  }
  
  await page.waitForLoadState('networkidle');
  
  // Update title field
  console.log("   Updating title...");
  const titleField = "#ctl00_MainContent_TbTitle";
  try {
    const el = await page.$(titleField);
    if (el) {
      await page.click(titleField, { clickCount: 3 });
      await page.press(titleField, "Backspace");
      await page.type(titleField, newTitle);
      console.log(`     ✅ Title: ${newTitle}`);
    } else {
      console.log(`     ❌ Title field not found`);
      return false;
    }
  } catch (e) {
    console.log(`     ❌ Error: ${e.message}`);
    return false;
  }
  
  // Update meta field
  console.log("   Updating meta description...");
  const metaField = "#ctl00_MainContent_TbMetaDescription";
  try {
    const el = await page.$(metaField);
    if (el) {
      await page.click(metaField, { clickCount: 3 });
      await page.press(metaField, "Backspace");
      await page.type(metaField, newMeta);
      console.log(`     ✅ Meta: ${newMeta.substring(0, 50)}...`);
    } else {
      console.log(`     ❌ Meta field not found`);
    }
  } catch (e) {
    console.log(`     ❌ Error: ${e.message}`);
  }
  
  // Save
  if (!DRY_RUN) {
    console.log("   Saving article...");
    try {
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => {}),
        page.click("#ctl00_MainContent_BtnSave"),
      ]);
      console.log("   ✅ Article saved!");
      return true;
    } catch (e) {
      console.log(`   ❌ Error saving: ${e.message}`);
      return false;
    }
  } else {
    console.log("   (DRY-RUN: not saving)");
    return true;
  }
}

async function main() {
  console.log('\n' + '='.repeat(80));
  console.log(`🚀 QUICK WINS UPDATE (${detectedSite.toUpperCase()})`);
  console.log('='.repeat(80));
  
  if (DRY_RUN) console.log('⚠️  DRY-RUN MODE (not saving)\n');
  
  // Filter keywords
  let toUpdate = QUICK_WINS;
  if (KEYWORD) {
    toUpdate = QUICK_WINS.filter(k => k.keyword.toLowerCase().includes(KEYWORD.toLowerCase()));
    if (toUpdate.length === 0) {
      console.log(`❌ No keywords found matching "${KEYWORD}"`);
      process.exit(1);
    }
  }
  
  console.log(`Updating ${toUpdate.length} keyword(s):\n`);
  for (const item of toUpdate) {
    console.log(`  • ${item.keyword}`);
  }
  
  const browser = await chromium.launch({
    headless: HEADLESS,
    slowMo: 50,
  });
  
  try {
    const page = await browser.newPage();
    
    // Login
    console.log('\n🔐 Logging in...');
    await page.goto(LOGIN_URL, { waitUntil: 'networkidle' });
    
    // Accept cookies
    const cookieBtn = page.locator('#cbConfirm');
    if (await cookieBtn.count() > 0) {
      await cookieBtn.click();
      await page.waitForTimeout(500);
    }
    
    // Fill credentials
    await page.click('#ctl00_MainContent_LfLogin_LoginMain_UserName', { clickCount: 3 });
    await page.keyboard.press('Backspace');
    await page.type('#ctl00_MainContent_LfLogin_LoginMain_UserName', USERNAME, { delay: 60 });
    
    await page.click('#ctl00_MainContent_LfLogin_LoginMain_Password', { clickCount: 3 });
    await page.keyboard.press('Backspace');
    await page.type('#ctl00_MainContent_LfLogin_LoginMain_Password', PASSWORD, { delay: 60 });
    
    // Click login
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle', timeout: 10000 }).catch(() => {}),
      page.click('#ctl00_MainContent_LfLogin_LoginMain_BtnLogin'),
    ]);
    
    if (page.url().toLowerCase().includes('login')) {
      throw new Error('Login failed');
    }
    
    console.log('✅ Logged in!\n');
    
    // Update keywords
    let success = 0;
    for (const item of toUpdate) {
      const result = await updateKeyword(page, item.keyword, item.article, item.title, item.meta);
      if (result) success++;
      await page.waitForTimeout(2000);
    }
    
    console.log('\n' + '='.repeat(80));
    console.log(`✅ Complete! Updated ${success}/${toUpdate.length} keywords`);
    console.log('='.repeat(80));
    
    if (!DRY_RUN) {
      console.log('\n⏱️  Wait 2-3 dage for Google to crawl');
      console.log('📊 Check GSC: https://search.google.com/search-console\n');
    }
    
  } catch (err) {
    console.error('\n❌ Error: ' + err.message);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

main();
