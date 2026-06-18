#!/usr/bin/env node

/**
 * debug-articles.js
 * Show what articles are on the AdminTopics page
 */

import 'dotenv/config';
import { chromium } from 'playwright';

const { LOGIN_URL, ADMIN_URL, USERNAME, PASSWORD } = process.env;

if (!LOGIN_URL || !ADMIN_URL || !USERNAME || !PASSWORD) {
  console.error('❌ Missing env vars');
  process.exit(1);
}

(async () => {
  console.log('\n🔍 DEBUG: Listing all articles\n');
  
  const browser = await chromium.launch({ headless: true, slowMo: 50 });
  const page = await browser.newPage();
  
  try {
    // Login
    console.log('Logging in...');
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
    
    console.log('✅ Logged in!\n');
    
    // Go to AdminTopics
    console.log('Going to AdminTopics...\n');
    await page.goto(ADMIN_URL, { waitUntil: 'networkidle' });
    
    // Get all articles
    const articles = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('li.rlbItem')).map(el => {
        const tekst = (el.textContent || '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
        return tekst;
      });
    });
    
    console.log(`Found ${articles.length} articles:\n`);
    
    // Show first 20
    articles.slice(0, 20).forEach((art, i) => {
      console.log(`${i + 1}. ${art.substring(0, 80)}`);
    });
    
    // Search for "eskortepiger"
    console.log('\n\n🔍 Searching for "eskortepiger"...\n');
    
    const matches = articles.filter(a => a.toLowerCase().includes('eskortepiger'));
    
    if (matches.length > 0) {
      console.log(`✅ Found ${matches.length} match(es):`);
      matches.forEach((m, i) => {
        console.log(`   ${i + 1}. ${m}`);
      });
    } else {
      console.log('❌ No matches for "eskortepiger"');
      console.log('\nSearching for partial matches...');
      
      const keywords = ['eskort', 'piger', 'escort'];
      for (const kw of keywords) {
        const partial = articles.filter(a => a.toLowerCase().includes(kw));
        if (partial.length > 0) {
          console.log(`\n   Contains "${kw}" (${partial.length} matches):`);
          partial.slice(0, 5).forEach(m => {
            console.log(`     • ${m.substring(0, 70)}`);
          });
        }
      }
    }
    
  } catch (err) {
    console.error('\n❌ Error: ' + err.message);
  } finally {
    await browser.close();
  }
})();
