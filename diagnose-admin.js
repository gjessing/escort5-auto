// diagnose-admin.js — Finder sprog-vaelger i admin-panelet
// Brug: node diagnose-admin.js
// Logger ind, aabner foerste ordbogs-indlaeg, og viser alle dropdowns/tabs/sprog-elementer.

import 'dotenv/config';
import { chromium } from 'playwright';
import { assertRequiredEnv } from './security.js';

const erLinuxServer = process.platform === 'linux' && !process.env.DISPLAY;
const HEADLESS = erLinuxServer;

const { LOGIN_URL, ADMIN_URL, USERNAME, PASSWORD } = process.env;
assertRequiredEnv(['LOGIN_URL', 'ADMIN_URL', 'USERNAME', 'PASSWORD']);

(async () => {
  console.log('\n================================================');
  console.log('  diagnose-admin.js — Find sprog-vaelger');
  console.log('================================================\n');

  const browser = await chromium.launch({ headless: HEADLESS, slowMo: 50 });
  const page = await browser.newPage();

  page.on('dialog', async d => { try { await d.accept(); } catch(_) {} });

  // ── Login ───────────────────────────────────────
  console.log('Logger ind...');
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
  if (page.url().toLowerCase().includes('login')) throw new Error('Login fejlede');
  console.log('  OK: Logget ind\n');

  // ── Naviger til admin og vaelg ordbog ──────────
  console.log('Aabner ordbog-kategori...');
  await page.goto(ADMIN_URL, { waitUntil: 'networkidle' });
  await page.click('#ctl00_MainContent_RblTopicCategory_ctl01');
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1500);

  // ── Klik foerste indlaeg ────────────────────────
  console.log('Klikker foerste ordbogs-indlaeg...');
  const foerste = page.locator('li.rlbItem').first();
  if (await foerste.count() === 0) throw new Error('Ingen ordbogs-indlaeg fundet');
  const foersteTekst = await foerste.textContent();
  console.log('  Aabnet: ' + (foersteTekst || '').substring(0, 50).trim() + '\n');
  await foerste.click();
  try { await page.waitForLoadState('networkidle', { timeout: 10000 }); } catch(_) {}
  try { await page.waitForSelector('#ctl00_MainContent_TbTitle', { timeout: 6000 }); } catch(_) {}
  await page.waitForTimeout(2000);

  // ── Diagnose: find alle sprog-relaterede elementer ──────
  console.log('Scanner siden for sprog-vaelgere...\n');
  const fund = await page.evaluate(() => {
    const result = {
      selects: [],
      sprogTekstElementer: [],
      tabs: [],
      flag: []
    };

    // Alle <select> dropdowns
    document.querySelectorAll('select').forEach(s => {
      result.selects.push({
        id: s.id || '(ingen id)',
        name: s.name || '(intet navn)',
        synlig: s.offsetParent !== null,
        valgtVaerdi: s.value,
        muligheder: Array.from(s.options).slice(0, 15).map(o => ({
          value: o.value,
          text: o.text.trim()
        }))
      });
    });

    // Elementer med "lang", "sprog", "language", "locale", "translation" i id/class/name
    const sprogSoegOrd = ['lang', 'sprog', 'language', 'locale', 'translat', 'sprak'];
    const alle = document.querySelectorAll('*');
    for (let i = 0; i < alle.length; i++) {
      const el = alle[i];
      const id = (el.id || '').toLowerCase();
      const cls = (el.className && typeof el.className === 'string' ? el.className : '').toLowerCase();
      const navn = (el.name || '').toLowerCase();
      const samlet = id + ' ' + cls + ' ' + navn;
      if (sprogSoegOrd.some(s => samlet.includes(s))) {
        // Spring children over som ikke er interaktive containere
        if (['SCRIPT', 'STYLE', 'META'].includes(el.tagName)) continue;
        result.sprogTekstElementer.push({
          tag: el.tagName,
          id: el.id || '(ingen id)',
          class: (typeof el.className === 'string' ? el.className : '').substring(0, 60),
          synlig: el.offsetParent !== null,
          tekst: (el.textContent || '').substring(0, 60).trim()
        });
        if (result.sprogTekstElementer.length >= 30) break;
      }
    }

    // Tabs / fane-lignende strukturer
    document.querySelectorAll('[role="tab"], [class*="rtab" i], [id*="rtb" i], li.rtsLI, .RadTabStrip a').forEach(t => {
      result.tabs.push({
        tag: t.tagName,
        id: t.id || '(ingen id)',
        class: (typeof t.className === 'string' ? t.className : '').substring(0, 60),
        tekst: (t.textContent || '').substring(0, 50).trim()
      });
    });

    // Flag-billeder (typisk <img> med fx 'da.png', 'en.gif')
    document.querySelectorAll('img').forEach(img => {
      const src = (img.src || '').toLowerCase();
      if (/[\/_\-](da|dk|en|gb|us|se|sv|fi|no|de)[\._]/.test(src) ||
          /flag/i.test(src) || /lang/i.test(src)) {
        result.flag.push({
          src: img.src,
          alt: img.alt,
          parentId: img.parentElement ? img.parentElement.id : ''
        });
      }
    });

    return result;
  });

  // ── Print resultater ────────────────────────────
  console.log('=== <SELECT> dropdowns paa siden ===');
  if (fund.selects.length === 0) {
    console.log('  (ingen fundet)');
  } else {
    fund.selects.forEach((s, i) => {
      console.log('\n  ' + (i+1) + '. id="' + s.id + '" name="' + s.name + '"' + (s.synlig ? '' : ' [SKJULT]'));
      console.log('     Aktuel vaerdi: "' + s.valgtVaerdi + '"');
      console.log('     Muligheder (foerste 15):');
      s.muligheder.forEach(m => console.log('       - "' + m.value + '" => "' + m.text + '"'));
    });
  }

  console.log('\n=== Elementer med sprog/language/locale i id/class/name ===');
  if (fund.sprogTekstElementer.length === 0) {
    console.log('  (ingen fundet)');
  } else {
    fund.sprogTekstElementer.forEach((e, i) => {
      console.log('  ' + (i+1) + '. <' + e.tag + '> id="' + e.id + '"' + (e.synlig ? '' : ' [SKJULT]'));
      if (e.class) console.log('     class="' + e.class + '"');
      if (e.tekst) console.log('     tekst: "' + e.tekst + '"');
    });
  }

  console.log('\n=== Mulige tabs/faner ===');
  if (fund.tabs.length === 0) {
    console.log('  (ingen fundet)');
  } else {
    fund.tabs.slice(0, 20).forEach((t, i) => {
      console.log('  ' + (i+1) + '. <' + t.tag + '> id="' + t.id + '" tekst="' + t.tekst + '"');
    });
  }

  console.log('\n=== Flag-billeder ===');
  if (fund.flag.length === 0) {
    console.log('  (ingen fundet)');
  } else {
    fund.flag.forEach((f, i) => {
      console.log('  ' + (i+1) + '. ' + f.src + (f.alt ? ' (alt="' + f.alt + '")' : '') + (f.parentId ? ' parent="' + f.parentId + '"' : ''));
    });
  }

  // ── Screenshot ──────────────────────────────────
  const stiBillede = 'admin-discovery.png';
  await page.screenshot({ path: stiBillede, fullPage: true });
  console.log('\nScreenshot gemt: ' + stiBillede);
  console.log('\nFaerdig — kopier outputtet ovenfor til mig saa kan jeg bygge sprog-skift logikken.\n');

  await page.waitForTimeout(2000);
  await browser.close();
})().catch(err => {
  console.error('\nFejl: ' + err.message);
  process.exit(1);
});
