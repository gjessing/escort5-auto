// oversaet-ordbog.js — Oversaetter eksisterende ordbogs-opslag til engelsk eller svensk.
// Bruger CbLanguage RadComboBox til at skifte sprog paa samme indlaeg.
// Brug:
//   node oversaet-ordbog.js --sprog en --max 1
//   node oversaet-ordbog.js --sprog sv --max 5
//   node oversaet-ordbog.js --sprog en --max 1 --dry
//   node oversaet-ordbog.js --sprog en --ord "Dildo show"

import 'dotenv/config';
import { chromium } from 'playwright';
import fetch from 'node-fetch';
import minimist from 'minimist';
import { assertRequiredEnv, parsePositiveInt } from './security.js';

const args = minimist(process.argv.slice(2));
const SPROG_KODE = (args.sprog || args.s || '').toLowerCase();
const MAX = parsePositiveInt(args.max, 'max', 999);
const DRY = args.dry === true;
const LOOKUP = (args.ord || args.soeg || args.soege || args.word || args.term || '').toString().trim();
const IGNORE_LOG = LOOKUP.length > 0;
const erLinuxServer = process.platform === 'linux' && !process.env.DISPLAY;
const HEADLESS = args.headless === true || erLinuxServer;
const TYPE = 'ordbog'; // Stoetter kun ordbog for nu

function normalizeText(str) {
  return (str || '').toString().toLowerCase().replace(/[^a-z0-9æøå]+/g, '');
}

// === SPROG-KORTLAEGNING ===
const SPROG = {
  'en':      { tekst: 'Engelsk', navn: 'engelsk', engelsk: 'English' },
  'engelsk': { tekst: 'Engelsk', navn: 'engelsk', engelsk: 'English' },
  'sv':      { tekst: 'Svensk',  navn: 'svensk',  engelsk: 'Swedish' },
  'se':      { tekst: 'Svensk',  navn: 'svensk',  engelsk: 'Swedish' },
  'svensk':  { tekst: 'Svensk',  navn: 'svensk',  engelsk: 'Swedish' },
  'da':      { tekst: 'Dansk',   navn: 'dansk',   engelsk: 'Danish' },
  'dansk':   { tekst: 'Dansk',   navn: 'dansk',   engelsk: 'Danish' },
};
const sprogInfo = SPROG[SPROG_KODE];
if (!sprogInfo || sprogInfo.tekst === 'Dansk') {
  console.error('\nMangler eller ugyldigt --sprog. Brug: --sprog en  eller  --sprog sv');
  process.exit(1);
}

// === ENV ===
const { LOGIN_URL, ADMIN_URL, USERNAME, PASSWORD, ANTHROPIC_API_KEY } = process.env;
assertRequiredEnv(['LOGIN_URL', 'ADMIN_URL', 'USERNAME', 'PASSWORD', 'ANTHROPIC_API_KEY']);

const KATEGORI_ORDBOG = '#ctl00_MainContent_RblTopicCategory_ctl01';
const LOG_FIL = 'oversaet-ordbog-log.json';

// === LOG-HJAELPERE ===
async function laesLogAsync() {
  try {
    const { readFileSync } = await import('fs');
    const data = JSON.parse(readFileSync(LOG_FIL, 'utf8'));
    if (!data.behandlet) data.behandlet = [];
    if (!data.detaljer) data.detaljer = {};
    return data;
  } catch(_) { return { behandlet: [], detaljer: {} }; }
}
async function gemLog(log) {
  const { writeFileSync } = await import('fs');
  writeFileSync(LOG_FIL, JSON.stringify(log, null, 2));
}

// === CLAUDE OVERSAETTELSE ===
async function oversaet(opslagsord, daTitel, daBody, maxTitelLaengde) {
  const maalSprog = sprogInfo.navn;
  const maxLen = maxTitelLaengde && maxTitelLaengde > 0 ? maxTitelLaengde : 60;

  const prompt = `Du er professionel oversaetter for en escort/massage-ordbog.
Oversaet dette ordbogs-opslag fra dansk til ${maalSprog} (${sprogInfo.engelsk}).

OPSLAGSORD: "${opslagsord}"
DANSK TITEL: "${daTitel}"
DANSK BROEDTEKST (HTML):
${(daBody || '').substring(0, 4000)}

REGLER:
- Brug naturligt, idiomatisk ${maalSprog} - ikke maskinoversat
- Behold HTML-struktur PRAECIS: samme antal <h2>, samme antal <p>, samme rakkefoelge
- Behold ALLE <a href="..."> URL'er UÆNDRET (samme links - sprog vaelges via cookie paa siden)
- Oversaet ankertekst i links til ${maalSprog}
- Oversaet h2-overskrifter til ${maalSprog} (fx "Saadan bruges X" -> "How to use X")
- Hold den oversatte titel UNDER ${maxLen} tegn (vigtigt!)
- Behold spoergsmaal-format i titel (fx "X — what does it mean?" / "X — vad betyder det?")
- Naevn opslagsordet flere gange naturligt for SEO
- Ingen markdown, kun HTML (h2, p, a)

Returner KUN et rent JSON-objekt uden markdown backticks:
{
  "nyTitel": "den oversatte titel (under ${maxLen} tegn)",
  "nyBody": "den oversatte broedtekst som HTML"
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
    const err = await res.text().catch(() => '');
    throw new Error('Claude API HTTP fejl: ' + res.status + ' - ' + err.slice(0, 200));
  }
  const data = await res.json();
  if (data.error) throw new Error('Claude API fejl: ' + data.error.message);
  if (!Array.isArray(data.content)) throw new Error('Claude API fejl: uventet svarformat');

  const tekst = data.content.map(b => b.text || '').join('').trim();
  const renTekst = tekst.replace(/```json|```/g, '').trim();
  let parsed;
  try { parsed = JSON.parse(renTekst); }
  catch { throw new Error('Claude API fejl: ugyldigt JSON-svar'); }
  if (typeof parsed.nyTitel !== 'string' || typeof parsed.nyBody !== 'string') {
    throw new Error('Claude API fejl: manglende felter nyTitel/nyBody');
  }
  return parsed;
}

// === SPROG-SKIFT VIA RADCOMBOBOX ===
async function vaelgSprog(page, sprogTekst) {
  // sprogTekst: "Dansk", "Engelsk" eller "Svensk"
  // Probleer foerst Telerik client-API, falder tilbage til DOM-klik
  const lykkedes = await page.evaluate((mal) => {
    try {
      if (typeof window.$find === 'function') {
        const combo = window.$find('ctl00_MainContent_CbLanguage');
        if (combo && typeof combo.findItemByText === 'function') {
          const item = combo.findItemByText(mal);
          if (item) { item.select(); return 'telerik-api'; }
        }
      }
    } catch(_) {}
    return null;
  }, sprogTekst);

  if (!lykkedes) {
    // Fallback: aaben dropdown via klik paa pilen, klik option
    await page.click('#ctl00_MainContent_CbLanguage_Arrow').catch(() => {});
    await page.waitForTimeout(400);
    const dropdown = page.locator('#ctl00_MainContent_CbLanguage_DropDown');
    try { await dropdown.waitFor({ state: 'visible', timeout: 3000 }); } catch(_) {}
    const option = dropdown.locator('li', { hasText: sprogTekst }).first();
    await option.click();
  }

  // Vent paa postback
  try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch(_) {}
  await page.waitForTimeout(1500);
  return lykkedes || 'dom-klik';
}

// ─── MAIN ───────────────────────────────────────────────────────────────
(async () => {
  console.log('\n================================================');
  console.log('  oversaet-ordbog.js — Oversaet til ' + sprogInfo.tekst);
  console.log('================================================');
  console.log('Sprog: ' + sprogInfo.tekst + ' | Max: ' + MAX + (DRY ? ' | DRY-RUN' : ''));
  console.log('');

  const browser = await chromium.launch({ headless: HEADLESS, slowMo: 50 });
  const page = await browser.newPage();
  page.on('dialog', async d => {
    console.log('  Dialog: "' + d.message().substring(0, 80) + '" - accepterer');
    try { await d.accept(); } catch(_) {}
  });

  // ── Login ──
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

  // ── Vaelg ordbog-kategori ──
  await page.goto(ADMIN_URL, { waitUntil: 'networkidle' });
  const katKnap = page.locator(KATEGORI_ORDBOG);
  if (await katKnap.count() === 0) throw new Error('Ordbog-kategori ikke fundet');
  await katKnap.click();
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1000);
  console.log('  OK: Ordbog-kategori valgt');

  // ── Hent liste ──
  let indlaeg = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('li.rlbItem')).map(el => {
      const fulTekst = (el.textContent || '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
      const summ = el.querySelector('.summery');
      const slugTekst = summ ? summ.textContent.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim() : '';
      let tekst = fulTekst;
      if (slugTekst && fulTekst.toLowerCase().endsWith(slugTekst.toLowerCase())) {
        tekst = fulTekst.slice(0, fulTekst.length - slugTekst.length).trim();
      }
      return { tekst: tekst || fulTekst, id: el.id };
    }).filter(el => el.id);
  });
  console.log('  Fandt ' + indlaeg.length + ' ordbogs-indlaeg');

  if (LOOKUP) {
    const lookupNorm = normalizeText(LOOKUP);
    indlaeg = indlaeg.filter(it => {
      const textNorm = normalizeText(it.tekst);
      return textNorm.includes(lookupNorm) || it.tekst.toLowerCase().includes(LOOKUP.toLowerCase());
    });
    console.log('  Filter: viser kun opslag der matcher: "' + LOOKUP + '"');
    if (indlaeg.length === 0) {
      console.log('  Ingen opslag fundet for det angivne ord. Kontroller stavning og prøv igen.');
      await browser.close();
      process.exit(0);
    }
  }

  // ── Filtrer behandlede (per sprog) ──
  const log = await laesLogAsync();
  const sprogNoegle = ':' + SPROG_KODE; // fx ":en" eller ":sv"
  const erBehandlet = id => log.behandlet.includes(TYPE + ':' + id + sprogNoegle);
  const ubehandlede = indlaeg.filter(it => IGNORE_LOG || !erBehandlet(it.id));
  console.log('  Allerede oversat til ' + sprogInfo.tekst + ': ' + (indlaeg.length - ubehandlede.length));
  console.log('  Tilbage at oversaette: ' + ubehandlede.length + '\n');

  const behandl = ubehandlede.slice(0, MAX);
  let antalOK = 0, antalSpring = 0;

  for (let i = 0; i < behandl.length; i++) {
    const item = behandl[i];
    console.log('─'.repeat(50));
    console.log((i+1) + '/' + behandl.length + ' — ' + item.tekst.substring(0, 50));

    if (DRY) {
      console.log('  [DRY-RUN] Ville oversaette: ' + item.tekst);
      continue;
    }

    try {
      // ── Naviger og find indlaegget ──
      await page.goto(ADMIN_URL, { waitUntil: 'networkidle' });
      const kb = page.locator(KATEGORI_ORDBOG);
      if (await kb.count() > 0) { await kb.click(); await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(1000); }

      const renTekst = item.tekst.replace(/[.?!]/g, '').trim();
      const matchResultat = await page.evaluate((soege) => {
        const its = Array.from(document.querySelectorAll('li.rlbItem'));
        let bedstePri = 0, bedsteEl = null;
        const sl = soege.toLowerCase().trim();
        for (const el of its) {
          const summ = el.querySelector('.summery');
          const slugTekst = summ ? summ.textContent.trim() : '';
          const fulTekst = (el.textContent || '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
          let tekst = fulTekst;
          if (slugTekst && fulTekst.toLowerCase().endsWith(slugTekst.toLowerCase())) {
            tekst = fulTekst.slice(0, fulTekst.length - slugTekst.length).trim();
          }
          const tl = tekst.toLowerCase();
          let p = 0;
          if (tl === sl) p = 4;
          else if (tl.startsWith(sl)) p = 3;
          else if (tl.includes(' ' + sl + ' ') || tl.includes(' ' + sl) || tl.includes(sl + ' ')) p = 2;
          else if (tl.includes(sl)) p = 1;
          if (p > bedstePri) { bedstePri = p; bedsteEl = el; }
        }
        if (bedsteEl) { bedsteEl.click(); return true; }
        return false;
      }, renTekst);

      if (!matchResultat) {
        console.log('  Advarsel: Indlaeg ikke fundet i listen');
        antalSpring++; continue;
      }

      // Vent paa form loader (DA er default)
      try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch(_) {}
      try { await page.waitForSelector('#ctl00_MainContent_TbTitle', { timeout: 6000 }); } catch(_) {}
      await page.waitForTimeout(1500);

      // ── Laes dansk indhold ──
      const da = await page.evaluate(() => {
        const get = id => { const el = document.getElementById(id); return el ? el.value : ''; };
        let body = get('ctl00_MainContent_EdtBodyContentHiddenTextarea');
        if (!body || body.length < 10) {
          try {
            document.querySelectorAll('.RadEditor').forEach(e => {
              try { if (e.control && e.control.get_html) { const h = e.control.get_html(); if (h && h.length > 10) body = h; } } catch(_) {}
            });
          } catch(_) {}
        }
        if (!body || body.length < 10) {
          try {
            const ifr = document.querySelector('.reContentCell iframe');
            if (ifr && ifr.contentDocument) body = ifr.contentDocument.body.innerHTML;
          } catch(_) {}
        }
        return {
          opslagsord: get('ctl00_MainContent_TbTitle'),
          titel:      get('ctl00_MainContent_TbImageText'),
          body:       body,
        };
      });

      console.log('  Opslagsord:  ' + da.opslagsord);
      console.log('  DA titel:    ' + da.titel);
      console.log('  DA broedtekst: ' + (da.body ? da.body.length + ' tegn' : 'TOM!'));

      if (!da.titel || !da.body) {
        console.log('  Advarsel: Manglende DA titel eller broedtekst - springer over');
        antalSpring++; continue;
      }

      // ── Hent maxlength for at trunkere oversat titel hvis noedvendigt ──
      const titelMax = await page.evaluate(() => {
        const el = document.getElementById('ctl00_MainContent_TbImageText');
        return el && el.maxLength > 0 ? el.maxLength : 0;
      });

      // ── Oversaet via Claude ──
      const oversat = await oversaet(da.opslagsord || da.titel, da.titel, da.body, titelMax);
      // Trunker hvis over maxlength
      if (titelMax > 0 && oversat.nyTitel.length > titelMax) {
        const orig = oversat.nyTitel;
        let t = orig.substring(0, titelMax);
        const ls = t.lastIndexOf(' ');
        if (ls > titelMax * 0.7) t = t.substring(0, ls);
        oversat.nyTitel = t;
        console.log('  Titel trunkeret: ' + orig.length + ' -> ' + oversat.nyTitel.length + ' (max ' + titelMax + ')');
      }
      const ordAntal = (oversat.nyBody.replace(/<[^>]+>/g, ' ').trim().split(/\s+/).filter(Boolean)).length;
      const linkAntal = (oversat.nyBody.match(/<a\s+[^>]*href=/gi) || []).length;
      console.log('  Ny titel:    ' + oversat.nyTitel + ' (' + oversat.nyTitel.length + ' tegn)');
      console.log('  Ny tekst:    ' + oversat.nyBody.length + ' tegn | ' + ordAntal + ' ord | links: ' + linkAntal);

      // ── Skift sprog til maal ──
      console.log('  Skifter sprog til ' + sprogInfo.tekst + '...');
      const skiftMaade = await vaelgSprog(page, sprogInfo.tekst);
      console.log('  OK: Sprog skiftet (' + skiftMaade + ')');

      // Verificer at vi er paa det rigtige sprog
      const aktuelSprog = await page.evaluate(() => {
        const ipt = document.getElementById('ctl00_MainContent_CbLanguage_Input');
        return ipt ? ipt.value : null;
      });
      if (aktuelSprog && aktuelSprog !== sprogInfo.tekst) {
        console.log('  Advarsel: Sprog viser "' + aktuelSprog + '" - forventet "' + sprogInfo.tekst + '"');
      }

      // ── Skriv oversat titel til TbImageText ──
      const titelFelt = page.locator('#ctl00_MainContent_TbImageText');
      if (await titelFelt.count() > 0) {
        await titelFelt.click({ clickCount: 3 });
        await page.keyboard.press('Backspace');
        await titelFelt.fill(oversat.nyTitel);
        await page.evaluate(() => {
          const el = document.getElementById('ctl00_MainContent_TbImageText');
          if (el) {
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
        });
        console.log('  OK: Oversat titel skrevet');
      } else {
        throw new Error('TbImageText felt ikke fundet efter sprog-skift');
      }

      // ── Skriv oversat broedtekst til Telerik editor ──
      const bodyOK = await page.evaluate(args => {
        const resultater = [];
        try {
          document.querySelectorAll('.RadEditor').forEach(e => {
            if (e.control && typeof e.control.set_html === 'function') {
              e.control.set_html(args.html);
              try { if (typeof e.control.get_textArea === 'function') { const ta = e.control.get_textArea(); if (ta) ta.value = args.html; } } catch(_) {}
              resultater.push('RadEditor');
            }
          });
        } catch(e) { resultater.push('fejl:' + e.message); }
        try {
          document.querySelectorAll('.reContentCell iframe, .RadEditor iframe').forEach(ifr => {
            if (ifr.contentDocument && ifr.contentDocument.body) {
              ifr.contentDocument.body.innerHTML = args.html;
              resultater.push('iframe');
            }
          });
        } catch(_) {}
        const el = document.getElementById(args.id);
        if (el) {
          el.value = args.html;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          resultater.push('textarea');
        }
        return resultater.join(', ');
      }, { id: 'ctl00_MainContent_EdtBodyContentHiddenTextarea', html: oversat.nyBody });
      console.log('  OK: Oversat broedtekst skrevet via: ' + bodyOK);

      await page.waitForTimeout(500);

      // ── Screenshot foer save ──
      const slugFil = (item.tekst || 'item').toLowerCase()
        .replace(/æ/g,'ae').replace(/ø/g,'oe').replace(/å/g,'aa')
        .replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').substring(0,30) || 'item';
      try { await page.screenshot({ path: 'oversaet-' + SPROG_KODE + '-' + slugFil + '-foer.png', fullPage: true }); } catch(_) {}

      // ── Gem ──
      console.log('  Gemmer...');
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => {}),
        page.click('#ctl00_MainContent_BtnSave'),
      ]);
      await page.waitForTimeout(4000); // Laengere vent paa AJAX postback ved sprog-skift
      try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch(_) {}

      // ── Screenshot EFTER save ──
      try { await page.screenshot({ path: 'oversaet-' + SPROG_KODE + '-' + slugFil + '-efter.png', fullPage: true }); } catch(_) {}

      // ── Diagnostik: aktuelt sprog + felt-vaerdi ──
      const status1 = await page.evaluate(() => {
        const langEl = document.getElementById('ctl00_MainContent_CbLanguage_Input');
        const titEl = document.getElementById('ctl00_MainContent_TbImageText');
        return {
          aktuelSprog: langEl ? langEl.value : null,
          tbImageText: titEl ? titEl.value : null,
        };
      });
      console.log('  Efter save: sprog="' + status1.aktuelSprog + '" titel="' + (status1.tbImageText || '(tom)').substring(0, 50) + '"');

      let matcher = status1.tbImageText && status1.tbImageText.trim() === oversat.nyTitel.trim();

      // Hvis sproget skiftede tilbage automatisk, skift til target og tjek igen
      if (!matcher && status1.aktuelSprog && status1.aktuelSprog !== sprogInfo.tekst) {
        console.log('  Sprog skiftede til ' + status1.aktuelSprog + ' efter save. Skifter tilbage til ' + sprogInfo.tekst + '...');
        try { await vaelgSprog(page, sprogInfo.tekst); } catch(_) {}
        const status2 = await page.evaluate(() => {
          const titEl = document.getElementById('ctl00_MainContent_TbImageText');
          return titEl ? titEl.value : null;
        });
        console.log('  Efter sprog-tilbageskift: titel="' + (status2 || '(tom)').substring(0, 50) + '"');
        if (status2 && status2.trim() === oversat.nyTitel.trim()) matcher = true;
      }

      // Sidste forsoeg: naviger helt tilbage til indlaegget og tjek fra frisk page-load
      if (!matcher) {
        console.log('  Re-verificerer ved at genaabne indlaegget fra admin...');
        try {
          await page.goto(ADMIN_URL, { waitUntil: 'networkidle' });
          const kb3 = page.locator(KATEGORI_ORDBOG);
          if (await kb3.count() > 0) { await kb3.click(); await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(1000); }
          const renTekst3 = item.tekst.replace(/[.?!]/g, '').trim();
          const fundIgen = await page.evaluate((soege) => {
            const its = Array.from(document.querySelectorAll('li.rlbItem'));
            let p = 0, el = null;
            const sl = soege.toLowerCase().trim();
            for (const e of its) {
              const summ = e.querySelector('.summery');
              const sT = summ ? summ.textContent.trim() : '';
              const fT = (e.textContent || '').replace(/\s+/g, ' ').trim();
              let t = fT;
              if (sT && fT.toLowerCase().endsWith(sT.toLowerCase())) t = fT.slice(0, fT.length - sT.length).trim();
              const tl = t.toLowerCase();
              let pp = 0;
              if (tl === sl) pp = 4;
              else if (tl.startsWith(sl)) pp = 3;
              else if (tl.includes(sl)) pp = 2;
              if (pp > p) { p = pp; el = e; }
            }
            if (el) { el.click(); return true; }
            return false;
          }, renTekst3);

          if (fundIgen) {
            try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch(_) {}
            try { await page.waitForSelector('#ctl00_MainContent_TbTitle', { timeout: 6000 }); } catch(_) {}
            await page.waitForTimeout(1500);
            // Skift til target sprog og tjek
            await vaelgSprog(page, sprogInfo.tekst);
            const status3 = await page.evaluate(() => {
              const titEl = document.getElementById('ctl00_MainContent_TbImageText');
              return titEl ? titEl.value : null;
            });
            console.log('  Re-verifikation: titel="' + (status3 || '(tom)').substring(0, 50) + '"');
            if (status3 && status3.trim() === oversat.nyTitel.trim()) {
              matcher = true;
              console.log('  OK: Save er persisteret (verificeret efter genaabning)');
            }
          }
        } catch(e) {
          console.log('  Re-verifikation fejlede: ' + e.message);
        }
      }

      if (matcher) {
        console.log('  OK: Gemt og verificeret');
      } else {
        console.log('  ADVARSEL: Verifikation fejlede - oversaettelsen blev sandsynligvis IKKE gemt');
        console.log('           Forventet: ' + oversat.nyTitel.substring(0, 60));
        console.log('           Tjek screenshots: oversaet-' + SPROG_KODE + '-' + slugFil + '-{foer,efter}.png');
        antalSpring++;
        try { await vaelgSprog(page, 'Dansk'); } catch(_) {}
        continue;
      }

      // ── Skift tilbage til DA (saa admin er i default state) ──
      try { await vaelgSprog(page, 'Dansk'); } catch(_) {}

      // ── Log ──
      const logEfter = await laesLogAsync();
      const logKey = TYPE + ':' + item.id + sprogNoegle;
      if (!logEfter.behandlet.includes(logKey)) logEfter.behandlet.push(logKey);
      logEfter.detaljer[logKey] = {
        ord: item.tekst,
        sprog: sprogInfo.tekst,
        nyTitel: oversat.nyTitel,
        dato: new Date().toISOString()
      };
      await gemLog(logEfter);

      antalOK++;
      await page.waitForTimeout(1000);

    } catch(e) {
      console.log('  Fejl: ' + e.message);
      antalSpring++;
      // Forsoeg at skifte tilbage til DA selv ved fejl
      try { await vaelgSprog(page, 'Dansk'); } catch(_) {}
    }
  }

  await browser.close();
  console.log('\n' + '='.repeat(50));
  console.log('FAERDIG!');
  console.log('Oversat:       ' + antalOK);
  console.log('Sprunget over: ' + antalSpring);
  console.log('='.repeat(50) + '\n');
})().catch(err => {
  console.error('\nFejl: ' + err.message);
  process.exit(1);
});
