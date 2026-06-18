#!/usr/bin/env node

/**
 * quick-wins-update.js
 * Updates escort5.dk article titles/meta for Quick Wins keywords
 * Based on ret-gamle.js pattern
 * 
 * Usage: node quick-wins-update.js --keyword "eskortepiger" --dry-run
 *        node quick-wins-update.js  (updates all 4)
 */

import 'dotenv/config';
import { chromium } from 'playwright';
import minimist from 'minimist';

const args = minimist(process.argv.slice(2));
const KEYWORD = args.keyword || null;
const DRY_RUN = args['dry-run'] === true || args.dry === true;
const erLinuxServer = process.platform === 'linux' && !process.env.DISPLAY;
const HEADLESS = args.headless === true || erLinuxServer;

const { LOGIN_URL, ADMIN_URL, USERNAME, PASSWORD } = process.env;

if (!LOGIN_URL || !ADMIN_URL || !USERNAME || !PASSWORD) {
  console.error('❌ Missing env vars: LOGIN_URL, ADMIN_URL, USERNAME, PASSWORD');
  process.exit(1);
}

/**
 * Quick Wins keywords to update
 * Format: { keyword: "term", title: "new title", meta: "new meta" }
 */
const QUICK_WINS = [
  {
    keyword: "eskortepiger",
    title: "Eskortepiger i Danmark - Køb Escort Online",
    meta: "Find eskortepiger i Danmark. Diskret møte, professionel service. Book direkte online. Samme dag levering til hele landet.",
  },
];

// Add escort.se keywords if domain is escort.se
if ((process.env.SITE_URL || '').includes('.se')) {
  QUICK_WINS.push({
    keyword: "eskort guide",
    title: "Eskort Guide Sverige - Hitta Escorttjej Online",
    meta: "Eskort guide för Sverige. Hitta perfekt eskorttjej. Diskret bokring, professionell service. Alla regioner. Klicka här!",
  });
  QUICK_WINS.push({
    keyword: "sex tjejer i örebro",
    title: "Sex Tjejer Örebro - Book Direkt Online Nu",
    meta: "Sex tjejer i Örebro ready now! Diskret möte, professionell service. Many girls available. Book online instantly!",
  });
}

async function updateKeyword(page, keyword, title, meta) {
  console.log(`\n📝 Updating keyword: "${keyword}"`);

  // Gå til AdminTopics
  console.log("  Navigating to AdminTopics...");
  await page.goto(ADMIN_URL, { waitUntil: 'networkidle' });

  // Find og klik på artiklen via søgefunktionen (samme som ret-gamle.js)
  // Søg efter keyword i listen
  const items = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('li.rlbItem')).map(el => {
      const tekst = (el.textContent || '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
      return tekst;
    });
  });

  console.log(`  Found ${items.length} items in list`);

  // Find best match
  let bestMatch = null;
  let bestScore = 0;

  for (const item of items) {
    const itemLower = item.toLowerCase();
    const keywordLower = keyword.toLowerCase();

    // Scoring: eksakt > starter med > indeholder
    let score = 0;
    if (itemLower === keywordLower) score = 100;
    else if (itemLower.startsWith(keywordLower)) score = 50;
    else if (itemLower.includes(keywordLower)) score = 25;

    if (score > bestScore) {
      bestScore = score;
      bestMatch = item;
    }
  }

  if (!bestMatch) {
    console.log(`  ❌ Article not found for "${keyword}"`);
    return false;
  }

  console.log(`  ✅ Found article: "${bestMatch.substring(0, 60)}"`);

  // Klik på artiklen
  await page.click(`li.rlbItem:has-text("${bestMatch}")`);
  await page.waitForLoadState('networkidle');

  // Update title field
  console.log("  Updating title...");
  const titleField = "#ctl00_MainContent_TbTitle";
  try {
    const el = await page.$(titleField);
    if (el) {
      await page.click(titleField, { clickCount: 3 });
      await page.press(titleField, "Backspace");
      await page.type(titleField, title);
      console.log(`    ✅ Title: ${title}`);
    } else {
      console.log(`    ❌ Title field not found`);
    }
  } catch (e) {
    console.log(`    ❌ Error updating title: ${e.message}`);
  }

  // Update meta field
  console.log("  Updating meta description...");
  const metaField = "#ctl00_MainContent_TbMetaDescription";
  try {
    const el = await page.$(metaField);
    if (el) {
      await page.click(metaField, { clickCount: 3 });
      await page.press(metaField, "Backspace");
      await page.type(metaField, meta);
      console.log(`    ✅ Meta: ${meta.substring(0, 50)}...`);
    } else {
      console.log(`    ❌ Meta field not found`);
    }
  } catch (e) {
    console.log(`    ❌ Error updating meta: ${e.message}`);
  }

  // Save
  if (!DRY_RUN) {
    console.log("  Saving article...");
    try {
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => { }),
        page.click("#ctl00_MainContent_BtnSave"),
      ]);
      console.log("  ✅ Article saved!");
      return true;
    } catch (e) {
      console.log(`  ❌ Error saving: ${e.message}`);
      return false;
    }
  } else {
    console.log("  (DRY-RUN mode: not saving)");
    return true;
  }
}

async function main() {
  console.log('\n' + '='.repeat(80));
  console.log('🚀 QUICK WINS UPDATE');
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
      page.waitForNavigation({ waitUntil: 'networkidle', timeout: 10000 }).catch(() => { }),
      page.click('#ctl00_MainContent_LfLogin_LoginMain_BtnLogin'),
    ]);

    if (page.url().toLowerCase().includes('login')) {
      throw new Error('Login failed');
    }

    console.log('✅ Logged in!\n');

    // Update keywords
    let success = 0;
    for (const item of toUpdate) {
      const result = await updateKeyword(page, item.keyword, item.title, item.meta);
      if (result) success++;
      await page.waitForTimeout(2000); // Pause between updates
    }

    console.log('\n' + '='.repeat(80));
    console.log(`✅ Complete! Updated ${success}/${toUpdate.length} keywords`);
    console.log('='.repeat(80));

    if (!DRY_RUN) {
      console.log('\n⏱️  Wait 2-3 dage for Google to crawl and update rankings');
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
