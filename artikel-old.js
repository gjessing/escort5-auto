// escort5-auto/artikel.js
// Brug: node artikel.js --by "Kobenhavn" --emne "escort guide"

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
process.emitWarning = (warning, ...args) => { if (String(warning).includes('NODE_TLS')) return; require('events').EventEmitter.prototype.emit.call(process, 'warning', warning, ...args); };

import 'dotenv/config';
import { chromium } from 'playwright';
import fetch from 'node-fetch';
import minimist from 'minimist';

const args = minimist(process.argv.slice(2));
const BY      = args.by   || args.b || null;
const EMNE    = args.emne || args.e || null;
const EXTRA   = args.extra || '';
const HEADLESS = args.headless === true;
const BLOG = args.blog === true;

if (!BY || !EMNE) {
  console.error('\nMangler argumenter!');
  console.error('Brug: node artikel.js --by "Kobenhavn" --emne "escort guide"\n');
  process.exit(1);
}


async function hentBillede(by, emne) {
  const { readdirSync, existsSync } = await import('fs');
  const { join } = await import('path');

  const baseDir = join(process.cwd(), 'billeder');
  if (!existsSync(baseDir)) {
    console.log('  Info: Ingen billeder mappe fundet - springer over');
    return null;
  }

  // Lav liste af mapper der skal tjekkes - by og emne som noegleord
  const noegleord = [
    by.toLowerCase().replace(/ae/g,'ae').replace(/oe/g,'oe').replace(/aa/g,'aa').replace(/[^a-z0-9]/g,'-'),
    emne.toLowerCase().replace(/ae/g,'ae').replace(/oe/g,'oe').replace(/aa/g,'aa').replace(/[^a-z0-9]/g,'-').split('-')[0],
    'generelle'
  ];

  const billedTyper = ['.jpg', '.jpeg', '.png', '.webp'];

  for (const noegle of noegleord) {
    const mappe = join(baseDir, noegle);
    if (!existsSync(mappe)) continue;

    const filer = readdirSync(mappe).filter(f => billedTyper.some(ext => f.toLowerCase().endsWith(ext)));
    if (filer.length === 0) continue;

    // Vaelg tilfaeldigt billede fra mappen
    const valgt = filer[Math.floor(Math.random() * filer.length)];
    const sti = join(mappe, valgt);
    console.log('  OK: Billede valgt: ' + noegle + '/' + valgt);
    return sti;
  }

  console.log('  Advarsel: Ingen billeder fundet i billeder/ mappen');
  return null;
}
const { LOGIN_URL, ADMIN_URL, USERNAME, PASSWORD, ANTHROPIC_API_KEY } = process.env;

async function genererArtikel(by, emne, extra) {
  console.log('\nGenererer artikel om "' + emne + '" i ' + by + '...');

  const prompt = `Du er en SEO-skribent for escort5.dk - en dansk escort og massage guide.
Skriv en naturlig, ikke-AI-klingende artikel paa dansk om emnet "${emne}" med fokus paa "${by}".
${extra ? 'Ekstra instruktioner: ' + extra : ''}

Returner KUN et rent JSON-objekt (ingen markdown, ingen backticks):
{
  "imageText": "kort billedtekst 5-10 ord",
  "title": "SEO-titel ca. 55-60 tegn",
  "intro": "introtekst MAX 256 tegn",
  "body": "brodtekst 400-600 ord med h2 h3 og p HTML-tags",
  "meta": "meta-beskrivelse 140-160 tegn"
}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const data = await res.json();
  if (data.error) throw new Error('Claude API fejl: ' + data.error.message);

  const tekst = data.content.map(b => b.text || '').join('').trim();
  const artikel = JSON.parse(tekst);

  if (artikel.intro.length > 256) {
    artikel.intro = artikel.intro.substring(0, 253) + '...';
    console.log('  Advarsel: Intro afkortet til 256 tegn');
  }

  console.log('  OK: Artikel genereret!');
  console.log('      Titel: ' + artikel.title);
  console.log('      Intro: ' + artikel.intro.length + '/256 tegn');
  console.log('      Meta:  ' + artikel.meta.length + ' tegn');
  return artikel;
}

async function postArtikel(artikel) {
  console.log('\nStarter browser...');
  const browser = await chromium.launch({ headless: HEADLESS, slowMo: 60 });
  const page = await browser.newPage();

  // Login
  console.log('Logger ind...');
  await page.goto(LOGIN_URL, { waitUntil: 'networkidle' });

  // Accepter cookies hvis banner vises
  const cookieBtn = page.locator('#cbConfirm');
  if (await cookieBtn.count() > 0) {
    await cookieBtn.click();
    await page.waitForTimeout(500);
    console.log('  OK: Cookies accepteret');
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

  await page.waitForLoadState('networkidle');
  const urlEfterLogin = page.url();

  if (urlEfterLogin.toLowerCase().includes('login')) {
    throw new Error('Login fejlede - tjek brugernavn/adgangskode i .env');
  }
  console.log('  OK: Login lykkedes!');

  // Trin 1: Opret ny artikel
  console.log('\nTrin 1: Opretter ny artikel...');
  await page.goto(ADMIN_URL, { waitUntil: 'networkidle' });

  const baseSlug = ((artikel.by || BY || '') + '-' + (artikel.emne || EMNE || ''))
    .toLowerCase()
    .replace(/æ/g, 'ae').replace(/ø/g, 'oe').replace(/å/g, 'aa')
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  // Find eksisterende slugs paa siden og find naeste ledige nummer
  const eksisterendeSlugs = await page.evaluate(() => {
    const items = document.querySelectorAll('.rlItem, .rcbItem, li, td, .list-item');
    return Array.from(items).map(el => el.textContent.trim().toLowerCase().replace(/\s+/g, '-'));
  });

  let slug = baseSlug;
  let nr = 2;
  while (eksisterendeSlugs.some(s => s.includes(baseSlug))) {
    // Tjek om der er en eksakt match - ellers brug base slug
    if (!eksisterendeSlugs.includes(slug)) break;
    slug = baseSlug + '-' + nr;
    nr++;
  }
  console.log('  Slug: ' + slug);

  // Klik Blog-knap hvis --blog flag er sat
  if (BLOG) {
    const blogKnap = page.locator('#ctl00_MainContent_RblTopicCategory_ctl03');
    if (await blogKnap.count() > 0) {
      await blogKnap.click();
      await page.waitForTimeout(800);
      console.log('  OK: Blog valgt');
    }
  }

  await page.click('#ctl00_MainContent_LbTopics_Footer_TbNewTopic', { clickCount: 3 });
  await page.keyboard.press('Backspace');
  await page.type('#ctl00_MainContent_LbTopics_Footer_TbNewTopic', slug, { delay: 40 });

  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }),
    page.click('#ctl00_MainContent_LbTopics_Footer_BtnAddTopic'),
  ]);
  console.log('  OK: Ny artikel oprettet! URL: ' + page.url());

  // Trin 2: Udfyld felter
  console.log('\nTrin 2: Udfylder felter...');

  async function udfyld(id, vaerdi, label) {
    const el = page.locator('#' + id);
    if (await el.count() > 0) {
      await el.click({ clickCount: 3 });
      await page.keyboard.press('Backspace');
      await el.fill(vaerdi);
      console.log('  OK: ' + label);
    } else {
      console.log('  Advarsel: Felt ikke fundet: ' + id + ' (' + label + ')');
    }
  }

  await udfyld('ctl00_MainContent_TbImageText',       artikel.imageText, 'Billede-tekst');
  await udfyld('ctl00_MainContent_TbTitle',           artikel.title,     'Titel');
  await udfyld('ctl00_MainContent_TbIntro',           artikel.intro,     'Intro');
  await udfyld('ctl00_MainContent_TbMetaDescription', artikel.meta,      'Meta');

  // Brodtekst via Telerik
  const bodyEl = page.locator('#ctl00_MainContent_EdtBodyContentHiddenTextarea');
  if (await bodyEl.count() > 0) {
    await page.evaluate(function(args) {
      var el = document.getElementById(args.id);
      if (el) {
        el.value = args.html;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
      document.querySelectorAll('.RadEditor').forEach(function(e) {
        try { if (e.control) e.control.set_html(args.html); } catch(_) {}
      });
    }, { id: 'ctl00_MainContent_EdtBodyContentHiddenTextarea', html: artikel.body });
    console.log('  OK: Brodtekst');
  } else {
    console.log('  Advarsel: Brodtekst felt ikke fundet');
  }


  // Upload billede
  const billedeSti = await hentBillede(BY, EMNE);
  if (billedeSti) {
    const uploadFelt = page.locator('#ctl00_MainContent_AuImagefile0');
    if (await uploadFelt.count() > 0) {
      await uploadFelt.setInputFiles(billedeSti);
      await page.waitForTimeout(1000);
      console.log('  OK: Billede uploadet');
    } else {
      console.log('  Advarsel: Upload felt ikke fundet');
    }
  }

  // Klik Gem
  console.log('\nGemmer artikel...');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => {}),
    page.click('#ctl00_MainContent_BtnSave'),
  ]);
  console.log('  OK: Artikel gemt! URL: ' + page.url());

  await page.screenshot({ path: 'screenshot.png' });
  console.log('\nScreenshot gemt: screenshot.png');
  console.log('Browseren er aben - tjek felterne og tryk Gem.');
  console.log('Lukker automatisk om 3 minutter.\n');

  await page.waitForTimeout(180000);
  await browser.close();
}

(async () => {
  try {
    const artikel = await genererArtikel(BY, EMNE, EXTRA);
    await postArtikel(artikel);
  } catch (err) {
    console.error('\nFejl: ' + err.message);
    process.exit(1);
  }
})();
