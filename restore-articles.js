#!/usr/bin/env node

/**
 * restore-articles.js (FIXED)
 * Restores the 2 accidentally updated articles to their original titles
 */

import 'dotenv/config';
import { chromium } from 'playwright';
import minimist from 'minimist';

const args = minimist(process.argv.slice(2));
const DRY_RUN = args['dry-run'] === true || args.dry === true;
const HEADLESS = args.headless !== false;

const { LOGIN_URL, ADMIN_URL, USERNAME, PASSWORD } = process.env;

if (!LOGIN_URL || !ADMIN_URL || !USERNAME || !PASSWORD) {
  console.error('❌ Missing env vars');
  process.exit(1);
}

/**
 * Articles to restore with their CORRECT original titles
 */
const RESTORE_LIST = [
  {
    searchFor: "Escortpiger i Danmark - Køb Escort Online tantra",
    restoreTitle: "Tantra Sex i Danmark - Guide til Massage og Teknikker",
    restoreMeta: "",
  },
  {
    searchFor: "Eskortepiger i Danmark - Køb Escort Online eroguide",
    restoreTitle: "Eroguide anmeldelser af escort piger",
    restoreMeta: "",
  },
];

async function findAndRestoreArticle(page, searchTerm, restoreTitle, restoreMeta) {
  console.log(`\n🔍 Finding article with: "${searchTerm.substring(0, 50)}..."`);
  
  // Go to AdminTopics
  await page.goto(ADMIN_URL, { waitUntil: 'networkidle' });
  
  // Get all items
  const items = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('li.rlbItem')).map(el => {
      const tekst = (el.textContent || '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
      return tekst;
    });
  });
  
  // Find matching article
  let found = null;
  for (const item of items) {
    if (item.toLowerCase().includes(searchTerm.toLowerCase())) {
      found = item;
      break;
    }
  }
  
  if (!found) {
    console.log(`   ❌ Not found`);
    return false;
  }
  
  console.log(`   ✅ Found: "${found.substring(0, 60)}"`);
  
  // Click on it
  const allItems = await page.locator('li.rlbItem').all();
  let clicked = false;
  
  for (const item of allItems) {
    const text = await item.textContent();
    if (text && text.includes(found.substring(0, 30))) {
      await item.click();
      clicked = true;
      break;
    }
  }
  
  if (!clicked) {
    console.log(`   ❌ Could not click`);
    return false;
  }
  
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);
  
  // Get current title
  const currentTitle = await page.inputValue("#ctl00_MainContent_TbTitle");
  console.log(`   Current: "${currentTitle.substring(0, 50)}..."`);
  console.log(`   Restore: "${restoreTitle.substring(0, 50)}..."`);
  
  // Update title
  const titleField = "#ctl00_MainContent_TbTitle";
  try {
    await page.click(titleField, { clickCount: 3 });
    await page.press(titleField, "Backspace");
    await page.type(titleField, restoreTitle);
    console.log(`     ✅ Title updated`);
  } catch (e) {
    console.log(`     ❌ Error: ${e.message}`);
    return false;
  }
  
  // Save
  if (!DRY_RUN) {
    console.log(`   Saving...`);
    try {
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => {}),
        page.click("#ctl00_MainContent_BtnSave"),
      ]);
      console.log(`   ✅ Saved!`);
      return true;
    } catch (e) {
      console.log(`   ❌ Error saving: ${e.message}`);
      return false;
    }
  } else {
    console.log(`   (DRY-RUN: not saving)`);
    return true;
  }
}

async function main() {
  console.log('\n' + '='.repeat(80));
  console.log('🔄 RESTORE ARTICLES TO ORIGINAL TITLES');
  console.log('='.repeat(80));
  
  if (DRY_RUN) console.log('⚠️  DRY-RUN MODE\n');
  
  const browser = await chromium.launch({
    headless: HEADLESS,
    slowMo: 50,
  });
  
  try {
    const page = await browser.newPage();
    
    // Login
    console.log('\n🔐 Logging in...');
    await page.goto(LOGIN_URL, { waitUntil: 'networkidle' });
    
    const cookieBtn = page.locator('#cbConfirm');
    if (await cookieBtn.count() > 0) {
      await cookieBtn.click();
      await page.waitForTimeout(500);
    }
    
    await page.click('#ctl00_MainContent_LfLogin_LoginMain_UserName', { clickCount: 3 });
    await page.keyboard.press('Backspace');
    await page.type('#ctl00_MainContent_LfLogin_LoginMain_UserName', USERNAME, { delay: 60 });
    
    await page.click('#ctl00_MainContent_LfLogin_LoginMain_Password', { clickCount: 3 });
    await page.keyboard.press('Backspace');
    await page.type('#ctl00_MainContent_LfLogin_LoginMain_Password', PASSWORD, { delay: 60 });
    
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle', timeout: 10000 }).catch(() => {}),
      page.click('#ctl00_MainContent_LfLogin_LoginMain_BtnLogin'),
    ]);
    
    if (page.url().toLowerCase().includes('login')) {
      throw new Error('Login failed');
    }
    
    console.log('✅ Logged in!\n');
    
    // Restore articles
    let restored = 0;
    for (const item of RESTORE_LIST) {
      const result = await findAndRestoreArticle(page, item.searchFor, item.restoreTitle, item.restoreMeta);
      if (result) restored++;
      await page.waitForTimeout(2000);
    }
    
    console.log('\n' + '='.repeat(80));
    console.log(`✅ Done! Restored ${restored}/${RESTORE_LIST.length} articles`);
    console.log('='.repeat(80) + '\n');
    
  } catch (err) {
    console.error('\n❌ Error: ' + err.message);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

main();
