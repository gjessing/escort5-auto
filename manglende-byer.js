// manglende-byer.js
// Tjekker eksisterende blog indlaeg og finder manglende byer
// Brug: node manglende-byer.js

import 'dotenv/config';
import { chromium } from 'playwright';
import { assertRequiredEnv } from './security.js';

const { LOGIN_URL, ADMIN_URL, USERNAME, PASSWORD } = process.env;
assertRequiredEnv(['LOGIN_URL', 'ADMIN_URL', 'USERNAME', 'PASSWORD']);

// Danske byer der er relevante for escort
const DANSKE_BYER = [
  'København', 'Aarhus', 'Odense', 'Aalborg', 'Esbjerg',
  'Randers', 'Kolding', 'Horsens', 'Vejle', 'Roskilde',
  'Herning', 'Silkeborg', 'Helsingør', 'Næstved', 'Fredericia',
  'Viborg', 'Køge', 'Holstebro', 'Taastrup', 'Slagelse',
  'Hillerød', 'Sønderborg', 'Haderslev', 'Frederiksberg', 'Greve',
  'Gladsaxe', 'Ikast', 'Nyborg', 'Frederikshavn', 'Hjørring',
  'Thisted', 'Skive', 'Holbæk', 'Svendborg', 'Nykøbing Falster',
  'Ringsted', 'Hvidovre', 'Ballerup', 'Farum', 'Birkerød',
  'Lyngby', 'Glostrup', 'Brøndby', 'Ishøj', 'Albertslund',
];

(async () => {
  console.log('\nLogger ind og henter eksisterende blog indlaeg...');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Login
  await page.goto(LOGIN_URL, { waitUntil: 'networkidle' });
  const cookieBtn = page.locator('#cbConfirm');
  if (await cookieBtn.count() > 0) { await cookieBtn.click(); await page.waitForTimeout(500); }

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
    throw new Error('Login fejlede');
  }
  console.log('  OK: Logget ind');

  // Naviger til admin og vaelg Blog
  await page.goto(ADMIN_URL, { waitUntil: 'networkidle' });

  // Klik Blog knap
  const blogKnap = page.locator('#ctl00_MainContent_RblTopicCategory_ctl03');
  if (await blogKnap.count() > 0) {
    await blogKnap.click();
    await page.waitForTimeout(1500);
    console.log('  OK: Blog kategori valgt');
  }

  // Hent alle eksisterende blog slugs/titler
  const eksisterende = await page.evaluate(() => {
    const items = document.querySelectorAll('.rlbItem .rlbTemplate, .rlbItem span, li.rlbItem');
    return Array.from(items).map(el => el.textContent.trim().toLowerCase());
  });

  await browser.close();

  console.log('\n  Fandt ' + eksisterende.length + ' eksisterende blog indlaeg');

  // Find manglende byer
  const manglende = [];
  const daekkede = [];

  function normaliser(str) {
    return str.toLowerCase()
      .replace(/æ/g, 'ae').replace(/ø/g, 'oe').replace(/å/g, 'aa')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  for (const by of DANSKE_BYER) {
    const byNorm = normaliser(by);
    const harBy = eksisterende.some(slug => normaliser(slug).includes(byNorm));
    if (harBy) {
      daekkede.push(by);
    } else {
      manglende.push(by);
    }
  }

  console.log('\n' + '='.repeat(55));
  console.log('BYER MED BLOG INDLAEG (' + daekkede.length + '):');
  console.log('='.repeat(55));
  console.log(daekkede.join(', '));

  console.log('\n' + '='.repeat(55));
  console.log('MANGLENDE BYER (' + manglende.length + ') - skriv blog om disse:');
  console.log('='.repeat(55));
  manglende.forEach((by, i) => console.log((i + 1) + '. ' + by));

  console.log('\nTip: Generer automatisk blog for naeste manglende by:');
  if (manglende.length > 0) {
    console.log('node artikel.js --by "' + manglende[0] + '" --emne "escort guide" --blog');
    console.log('(Tip: brug menuen valg 4 for nem blog generering)');
  }
  console.log('');

})().catch(err => {
  console.error('\nFejl: ' + err.message);
  process.exit(1);
});
