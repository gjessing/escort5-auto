// auto.js - Fuldt automatisk: hent sogeord -> generer -> post
// Brug: node auto.js
// Eller: node auto.js --antal 3 --dage 90
import fs from 'fs';

const DAEKKEDE_FIL = 'skrevne-sogeord.json';
function hentDaekkede() {
  try {
    const arr = JSON.parse(fs.readFileSync(DAEKKEDE_FIL, 'utf8'));
    return new Set(arr.map(normaliser));
  } catch { return new Set(); }
}
function gemDaekket(sogeord) {
  const sat = hentDaekkede();
  sat.add(normaliser(sogeord));
  fs.writeFileSync(DAEKKEDE_FIL, JSON.stringify([...sat], null, 2));
}
function mulighedsScore(visninger, position) {
  let faktor;
  if (position <= 3)       faktor = 0.1;  // vinder allerede – nedprioritér
  else if (position <= 10) faktor = 1.0;  // tæt på – skub den
  else if (position <= 20) faktor = 1.5;  // side 2 – størst upside
  else                     faktor = 0.5;  // langt væk – svært at rykke
  return Math.round(visninger * faktor);
}
function langhaleFaktor(sogeord) {
  const ord = sogeord.trim().split(/\s+/).length;
  if (ord >= 3) return 1.5;   // lang-hale = lav konkurrence
  if (ord === 2) return 1.0;
  return 0.5;                 // enkelt head-term = høj konkurrence
}
function positionsFaktor(position) {
  if (position <= 3)  return 0.2;   // vinder allerede
  if (position <= 10) return 1.0;   // tæt på
  if (position <= 20) return 1.5;   // side 2 – størst upside
  return 0.6;
}
function beregnScore(row) {
  const efterspoergsel = Math.log10(row.impressions + 1); // dæmper mega-termer
  return Math.round(efterspoergsel * positionsFaktor(row.position) * langhaleFaktor(row.keys[0]) * 100);
}
function normaliser(sogeord) {
  return sogeord.toLowerCase().trim().split(/\s+/).sort().join(' ');
}

import 'dotenv/config';
import { google } from 'googleapis';
import { chromium } from 'playwright';
import fetch from 'node-fetch';
import minimist from 'minimist';
import { assertRequiredEnv, parsePositiveInt } from './security.js';

const args = minimist(process.argv.slice(2));
const ANTAL   = parsePositiveInt(args.antal, 'antal', 1);
const DAGE    = parsePositiveInt(args.dage, 'dage', 90);
// Auto-detekter Linux-server uden DISPLAY (ingen XServer) -> tving headless
const erLinuxServer = process.platform === 'linux' && !process.env.DISPLAY;
const HEADLESS = args.headless === true || erLinuxServer;
const BLOG = args.blog === true;
const SITE    = process.env.SITE_URL || 'https://escort5.dk/';

const { LOGIN_URL, ADMIN_URL, USERNAME, PASSWORD, ANTHROPIC_API_KEY } = process.env;
assertRequiredEnv(['LOGIN_URL', 'ADMIN_URL', 'USERNAME', 'PASSWORD', 'ANTHROPIC_API_KEY']);

// ── Hent top sogeord fra Search Console ───────────────────────────────────────
async function hentTopSogeord(antal, dage) {
  console.log('\nHenter sogeord fra Search Console...');

  const credentialsPath = process.env.GOOGLE_CREDENTIALS;
  if (!credentialsPath) throw new Error('GOOGLE_CREDENTIALS mangler. Angiv sti til credentials-fil i .env');
  const auth = new google.auth.GoogleAuth({
    keyFile: credentialsPath,
    scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
  });
  const searchconsole = google.searchconsole({ version: 'v1', auth });

  const slutDato = new Date();
  const startDato = new Date();
  startDato.setDate(slutDato.getDate() - dage);
  const format = d => d.toISOString().split('T')[0];

  const res = await searchconsole.searchanalytics.query({
    siteUrl: SITE,
    requestBody: {
      startDate: format(startDato),
      endDate: format(slutDato),
      dimensions: ['query'],
      rowLimit: 500,
      dimensionFilterGroups: [{
        filters: [{ dimension: 'country', operator: 'equals', expression: 'dnk' }]
      }]
    }
  });
const daekkede = hentDaekkede();
const rows = res.data.rows || [];
const setValgt = new Set();
const muligheder = rows
  .filter(r => r.impressions >= 30 && r.position > 3 && !daekkede.has(normaliser(r.keys[0])))
  .map(r => ({ row: r, score: beregnScore(r) }))
  .sort((a, b) => b.score - a.score)
  .filter(x => {
    const nf = normaliser(x.row.keys[0]);
    if (setValgt.has(nf)) return false;   // spring nær-dublet i samme batch over
    setValgt.add(nf);
    return true;
  })
  .slice(0, antal)
  .map(x => x.row);

  if (muligheder.length === 0) throw new Error('Ingen muligheder. Proev --dage 180 eller nulstil skrevne-sogeord.json');

  console.log('  Fandt ' + muligheder.length + ' sogeord (mulighedsscore):');
  muligheder.forEach((r, i) => {
    console.log('  ' + (i+1) + '. "' + r.keys[0] + '" (' + Math.round(r.impressions) + ' visn., pos ' + r.position.toFixed(1) + ', score ' + beregnScore(r) + ')');
  });

  return muligheder.map(r => r.keys[0]);
}

// ── Generer artikel via Claude API ────────────────────────────────────────────
async function genererArtikel(sogeord) {
  console.log('\nGenererer artikel for: "' + sogeord + '"...');

  // Detekter sprog baseret paa SITE_URL
  const erSvensk = (SITE || '').includes('.se');
  const sprog = erSvensk ? 'svensk' : 'dansk';
  const side = erSvensk ? 'escort.se - en svensk escort og massage guide' : 'escort5.dk - en dansk escort og massage guide';

  const prompt = `Du er en SEO-skribent for ${side}.
Analyser dette sogeord: "${sogeord}"

Skriv artiklen paa ${sprog} - naturligt og ikke-AI-klingende.

Returner KUN et rent JSON-objekt:
{
  "by": "den by sogeordet handler om, eller tom streng",
  "emne": "kort emne-beskrivelse",
  "imageText": "billedtekst 5-10 ord paa ${sprog}",
  "title": "SEO-titel ca. 55-60 tegn paa ${sprog}",
  "intro": "introtekst MAX 256 tegn paa ${sprog}",
  "body": "brodtekst 400-600 ord med h2 h3 og p HTML-tags, naturligt ${sprog}",
  "meta": "meta-beskrivelse 140-160 tegn paa ${sprog}"
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

  if (!res.ok) {
    const errorBody = await res.text().catch(() => '');
    throw new Error('Claude API HTTP fejl: ' + res.status + ' ' + res.statusText + (errorBody ? ' - ' + errorBody.slice(0, 200) : ''));
  }
  const data = await res.json();
  if (data.error) throw new Error('Claude API fejl: ' + data.error.message);
  if (!Array.isArray(data.content)) throw new Error('Claude API fejl: uventet svarformat');

  const tekst = data.content.map(b => b.text || '').join('').trim();
  const renTekst = tekst.replace(/```json|```/g, '').trim();
  let artikel;
  try {
    artikel = JSON.parse(renTekst);
  } catch {
    throw new Error('Claude API fejl: ugyldigt JSON-svar');
  }
  const requiredFields = ['emne', 'imageText', 'title', 'intro', 'body', 'meta'];
  for (const field of requiredFields) {
    if (typeof artikel[field] !== 'string' || !artikel[field].trim()) {
      throw new Error('Claude API fejl: manglende/ugyldigt felt "' + field + '"');
    }
  }

  if (artikel.intro.length > 256) artikel.intro = artikel.intro.substring(0, 253) + '...';

  console.log('  OK: "' + artikel.title + '"');
  return artikel;
}

// ── Hent lokalt billede ────────────────────────────────────────────────────────
async function hentBillede(by, emne) {
  const { readdirSync, existsSync } = await import('fs');
  const { join } = await import('path');
  const baseDir = join(process.cwd(), 'billeder');
  if (!existsSync(baseDir)) return null;

  const noegleord = [
    by.toLowerCase().replace(/[^a-z0-9]/g, '-'),
    emne.toLowerCase().split(' ')[0].replace(/[^a-z0-9]/g, '-'),
    'generelle'
  ];
  const billedTyper = ['.jpg', '.jpeg', '.png', '.webp'];

  for (const n of noegleord) {
    const mappe = join(baseDir, n);
    if (!existsSync(mappe)) continue;
    const filer = readdirSync(mappe).filter(f => billedTyper.some(ext => f.toLowerCase().endsWith(ext)));
    if (filer.length === 0) continue;
    const valgt = filer[Math.floor(Math.random() * filer.length)];
    console.log('  OK: Billede: ' + n + '/' + valgt);
    return join(mappe, valgt);
  }
  return null;
}

// ── Post artikel via Playwright ────────────────────────────────────────────────
async function postArtikel(artikel) {
  const browser = await chromium.launch({ headless: HEADLESS, slowMo: 60 });
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
  await page.waitForLoadState('networkidle');
  if (page.url().toLowerCase().includes('login')) throw new Error('Login fejlede');
  console.log('  OK: Logget ind');

  // Opret artikel
  await page.goto(ADMIN_URL, { waitUntil: 'networkidle' });
  const baseSlug = ((artikel.by || '') + '-' + artikel.emne)
    .toLowerCase()
    .replace(/æ/g, 'ae').replace(/ø/g, 'oe').replace(/å/g, 'aa')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  // Find eksisterende slugs og find naeste ledige nummer
  const eksisterendeSlugs = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.rlItem, .rcbItem, li, td, a'))
      .map(el => el.textContent.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''));
  });

  let slug = baseSlug;
  let slugNr = 2;
  while (eksisterendeSlugs.includes(slug)) {
    slug = baseSlug + '-' + slugNr;
    slugNr++;
  }

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
  console.log('  OK: Artikel oprettet: ' + slug);

  // Udfyld felter
  async function udfyld(id, val, label) {
    const el = page.locator('#' + id);
    if (await el.count() > 0) { await el.click({ clickCount: 3 }); await page.keyboard.press('Backspace'); await el.fill(val); console.log('  OK: ' + label); }
    else console.log('  Advarsel: ' + label + ' felt ikke fundet');
  }

  await udfyld('ctl00_MainContent_TbImageText',       artikel.imageText, 'Billede-tekst');
  await udfyld('ctl00_MainContent_TbTitle',           artikel.title,     'Titel');
  await udfyld('ctl00_MainContent_TbIntro',           artikel.intro,     'Intro');
  await udfyld('ctl00_MainContent_TbMetaDescription', artikel.meta,      'Meta');

  await page.evaluate(function(args) {
    var el = document.getElementById(args.id);
    if (el) { el.value = args.html; el.dispatchEvent(new Event('change', { bubbles: true })); }
    document.querySelectorAll('.RadEditor').forEach(function(e) { try { if (e.control) e.control.set_html(args.html); } catch(_) {} });
  }, { id: 'ctl00_MainContent_EdtBodyContentHiddenTextarea', html: artikel.body });
  console.log('  OK: Brodtekst');

  // Billede
  const billedeSti = await hentBillede(artikel.by || '', artikel.emne);
  if (billedeSti) {
    const uploadFelt = page.locator('#ctl00_MainContent_AuImagefile0');
    if (await uploadFelt.count() > 0) {
      await uploadFelt.setInputFiles(billedeSti);
      await page.waitForTimeout(1000);
      console.log('  OK: Billede uploadet');
    }
  }

  // Gem
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => {}),
    page.click('#ctl00_MainContent_BtnSave'),
  ]);
  console.log('  OK: Gemt! URL: ' + page.url());
  await browser.close();
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  try {
    const sogeord = await hentTopSogeord(ANTAL, DAGE);
    for (const s of sogeord) {
      console.log('\n' + '='.repeat(50));
      console.log('Behandler: "' + s + '"');
      console.log('='.repeat(50));
      const artikel = await genererArtikel(s);
      await postArtikel(artikel);
      gemDaekket(s);   // husk emnet, så det ikke vælges igen
      if (sogeord.length > 1) await new Promise(r => setTimeout(r, 3000));
    }
    console.log('\nFaerdig! ' + sogeord.length + ' artikel(er) oprettet og gemt.');
  } catch (err) {
    console.error('\nFejl: ' + err.message);
    process.exit(1);
  }
})();
