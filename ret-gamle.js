// ret-gamle.js
// Gennemgaar alle eksisterende artikler/blogs og:
// 1. Genererer bedre H1/titel via Claude
// 2. Optimerer brødtekst med bedre H2/H3 struktur
// 3. Opdaterer dato til dags dato
// Brug: node ret-gamle.js --type artikel --max 5

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
process.emitWarning = (warning, ...args) => { if (String(warning).includes('NODE_TLS')) return; require('events').EventEmitter.prototype.emit.call(process, 'warning', warning, ...args); };

import 'dotenv/config';
import { chromium } from 'playwright';
import fetch from 'node-fetch';
import minimist from 'minimist';

const args = minimist(process.argv.slice(2));
const TYPE     = args.type || 'artikel';
const MAX      = args.max  || 999;
const DRY      = args.dry  === true;
const HEADLESS = args.headless === true; // Standard: vis browser (headless kun med --headless)
const OPTIMERTEKST = args.optimertekst !== false; // standard: optimer tekst

const { LOGIN_URL, ADMIN_URL, USERNAME, PASSWORD, ANTHROPIC_API_KEY } = process.env;

// Log-fil til at huske hvilke artikler der er behandlet
const LOG_FIL = 'ret-gamle-log.json';

async function laesLogAsync() {
  try {
    const { readFileSync } = await import('fs');
    return JSON.parse(readFileSync(LOG_FIL, 'utf8'));
  } catch(e) {
    return { behandlet: [] };
  }
}

async function gemLog(log) {
  const { writeFileSync } = await import('fs');
  writeFileSync(LOG_FIL, JSON.stringify(log, null, 2));
}

// Korrekte kategori-knapper
const KATEGORIER = {
  'artikel':   '#ctl00_MainContent_RblTopicCategory_ctl00',
  'ordbog':    '#ctl00_MainContent_RblTopicCategory_ctl01',
  'startside': '#ctl00_MainContent_RblTopicCategory_ctl02',
  'blog':      '#ctl00_MainContent_RblTopicCategory_ctl03',
};

// Generer bedre H1 og optimeret brødtekst via Claude
async function optimerIndlaeg(titel, intro, body) {
  const erSvensk = (process.env.SITE_URL || '').includes('.se');
  const sprog = erSvensk ? 'svensk' : 'dansk';

  const prompt = `Du er en SEO-ekspert og skribent. Optimer dette indlaeg paa ${sprog}.

NUVAERENDE TITEL: "${titel}"
NUVAERENDE INTRO: "${(intro || '').substring(0, 300)}"
NUVAERENDE BROEDTEKST:
${(body || 'Ingen broedtekst').substring(0, 2000)}

Lav DISSE SPECIFIKKE forbedringer:
1. Skriv en optimal H1-titel (50-60 tegn, indeholder primaert soegeord, naturligt ${sprog})
2. Optimer broedteksten med god SEO-struktur:
   - Brug 2-3 h2 overskrifter der indeholder relevante soegeord
   - h2 skal vaere beskrivende og handlingsorienterede
   - h3 bruges KUN til underafsnit under en h2
   - Foerste overskrift ALTID h2 - aldrig h3
   - Hvert afsnit i p tag
3. Behold det originale indhold og laengde
4. Goer sproget naturligt - undgaa AI-klicheer

Returner KUN et rent JSON-objekt uden markdown backticks:
{
  "nyTitel": "den nye optimerede titel",
  "nyBody": "den optimerede broedtekst med 2-3 h2 overskrifter og p tags"
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
  const renTekst = tekst.replace(/```json|```/g, '').trim();
  return JSON.parse(renTekst);
}

(async () => {
  console.log('\n================================================');
  console.log('  ret-gamle.js — Opdater eksisterende indlaeg');
  console.log('================================================');
  console.log('Type: ' + TYPE + ' | Max: ' + MAX + (DRY ? ' | DRY-RUN' : '') + (OPTIMERTEKST ? ' | Med tekstoptimering' : ''));
  console.log('');

  const browser = await chromium.launch({ headless: HEADLESS, slowMo: 50 });
  const page = await browser.newPage();

  // Login
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

  // Find kategori knap
  const katSelector = KATEGORIER[TYPE.toLowerCase()];
  if (!katSelector) throw new Error('Ugyldig type: ' + TYPE + '. Brug: artikel, blog, ordbog, startside');

  // Naviger til admin og vaelg kategori
  await page.goto(ADMIN_URL, { waitUntil: 'networkidle' });
  const katKnap = page.locator(katSelector);
  if (await katKnap.count() > 0) {
    await katKnap.click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
    console.log('  OK: Kategori "' + TYPE + '" valgt');
  } else {
    throw new Error('Kategori-knap ikke fundet: ' + katSelector);
  }

  // Hent liste
  const indlaeg = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('li.rlbItem')).map(el => {
      // Hent fuld tekst
      const fulTekst = (el.textContent || '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();

      // Find slug-teksten i .summery elementet og fjern den fra slutningen
      const summery = el.querySelector('.summery');
      const slugTekst = summery ? summery.textContent.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim() : '';

      let tekst = fulTekst;
      if (slugTekst && fulTekst.toLowerCase().endsWith(slugTekst.toLowerCase())) {
        tekst = fulTekst.slice(0, fulTekst.length - slugTekst.length).trim();
      }

      return { tekst: tekst || fulTekst, id: el.id };
    }).filter(el => el.id);
  });

  console.log('  Fandt ' + indlaeg.length + ' indlaeg i kategorien "' + TYPE + '"');

  // Filtrer allerede behandlede fra FOER vi vaelger MAX antal
  const log = await laesLogAsync();
  const ubehandlede = indlaeg.filter(item => !log.behandlet.includes(TYPE + ':' + item.id));
  console.log('  Allerede behandlet: ' + (indlaeg.length - ubehandlede.length));
  console.log('  Tilbage at behandle: ' + ubehandlede.length + '\n');

  const behandl = ubehandlede.slice(0, MAX);
  let totalOpdateret = 0;
  let totalSprungetOver = 0;

  for (let i = 0; i < behandl.length; i++) {
    const item = behandl[i];
    console.log('─'.repeat(50));
    console.log((i + 1) + '/' + behandl.length + ' — ' + item.tekst.substring(0, 50));

    if (DRY) {
      console.log('  [DRY-RUN] Ville behandle: ' + item.tekst);
      continue;
    }

    try {
      // Naviger tilbage til admin og vaelg kategori
      await page.goto(ADMIN_URL, { waitUntil: 'networkidle' });
      const kb = page.locator(katSelector);
      if (await kb.count() > 0) {
        await kb.click();
        // Vent paa PostBack er faerdig og listen er opdateret
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(1000);
      }

      // Søg med fuld titel i filterfeltet
      const filterFelt = page.locator('#ctl00_MainContent_LbTopics_Header_TbFilter');
      let fundet = false;

      // Fjern tegn der kan forvirre filtersøgning (.?!)
      const renTekst = item.tekst.replace(/[.?!]/g, '').trim();
      console.log('  Søger efter: [' + renTekst + ']');

      if (await filterFelt.count() > 0) {
        // Ryd feltet og sæt ny søgetekst direkte via JavaScript
        const filterId = 'ctl00_MainContent_LbTopics_Header_TbFilter';
        await page.evaluate((args) => {
          const el = document.getElementById(args.id);
          if (el) {
            el.value = '';
            el.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }, { id: filterId });
        await page.waitForTimeout(300);
        await page.evaluate((args) => {
          const el = document.getElementById(args.id);
          if (el) {
            el.value = args.tekst;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }, { id: filterId, tekst: renTekst.trim() });
        await page.waitForTimeout(1500);

        // Hjaelpefunktion: find det rigtige element i listen
        // Find artikel direkte i DOM uden filter
        const fandtItem = await page.evaluate((soege) => {
          const items = Array.from(document.querySelectorAll('li.rlbItem'));
          for (let i = 0; i < items.length; i++) {
            const el = items[i];
            const summery = el.querySelector('.summery');
            const slugTekst = summery ? summery.textContent.trim() : '';
            const fulTekst = (el.textContent || '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
            let tekst = fulTekst;
            if (slugTekst && fulTekst.toLowerCase().endsWith(slugTekst.toLowerCase())) {
              tekst = fulTekst.slice(0, fulTekst.length - slugTekst.length).trim();
            }
            const tl = tekst.toLowerCase();
            const sl = soege.toLowerCase();
            if (tl.includes(sl) || sl.includes(tl.substring(0, Math.min(tl.length, 20)))) {
              el.click();
              return true;
            }
          }
          return false;
        }, renTekst);

        if (fandtItem) fundet = true;

        // Filter ryddes automatisk ved navigation til admin
      }

      if (!fundet) {
        console.log('  Advarsel: Indlaeg ikke fundet: ' + item.tekst.substring(0, 40));
        totalSprungetOver++;
        continue;
      }

      // Vent paa at siden er fuldt loadet efter klik
      try {
        await page.waitForLoadState('domcontentloaded', { timeout: 8000 });
      } catch(_) {}
      try {
        await page.waitForLoadState('networkidle', { timeout: 8000 });
      } catch(_) {}
      try {
        await page.waitForSelector('#ctl00_MainContent_TbTitle', { timeout: 6000 });
      } catch(_) {}
      await page.waitForTimeout(1500);

      // Laes nuvaerende indhold
      const nuvaerende = await page.evaluate(() => {
        const get = id => { const el = document.getElementById(id); return el ? el.value : ''; };

        // Laes body fra Telerik - prøv flere metoder
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
            const iframe = document.querySelector('.reContentCell iframe');
            if (iframe && iframe.contentDocument) body = iframe.contentDocument.body.innerHTML;
          } catch(_) {}
        }

        return {
          titel:     get('ctl00_MainContent_TbTitle'),
          intro:     get('ctl00_MainContent_TbIntro'),
          body:      body,
          imageText: get('ctl00_MainContent_TbImageText'),
        };
      });

      if (!nuvaerende.titel) {
        console.log('  Advarsel: Ingen titel fundet - springer over');
        totalSprungetOver++;
        continue;
      }

      // Verificer at vi har den rigtige artikel - ikke en anden der tilfaeldigvis er oeverst
      const forventetTitel = item.tekst.toLowerCase().replace(/[.?!]/g, '').trim().substring(0, 15);
      const faktiskTitel = nuvaerende.titel.toLowerCase().replace(/[.?!]/g, '').trim().substring(0, 15);
      if (forventetTitel && faktiskTitel && !faktiskTitel.includes(forventetTitel) && !forventetTitel.includes(faktiskTitel)) {
        console.log('  Advarsel: Forkert artikel aabnet!');
        console.log('           Forventet: ' + item.tekst.substring(0, 40));
        console.log('           Fik:       ' + nuvaerende.titel.substring(0, 40));
        totalSprungetOver++;
        continue;
      }

      console.log('  Gammel titel: ' + nuvaerende.titel);
      console.log('  Broedtekst laest: ' + (nuvaerende.body ? nuvaerende.body.length + ' tegn' : 'TOM - ingen tekst fundet!'));

      // Optimer via Claude
      const optimeret = await optimerIndlaeg(nuvaerende.titel, nuvaerende.intro, nuvaerende.body);
      console.log('  Ny titel:     ' + optimeret.nyTitel + ' (' + optimeret.nyTitel.length + ' tegn)');
      const h2antal = (optimeret.nyBody.match(/<h2/gi) || []).length;
      const h3antal = (optimeret.nyBody.match(/<h3/gi) || []).length;
      console.log('  Ny tekst:     ' + optimeret.nyBody.length + ' tegn | h2: ' + h2antal + ' | h3: ' + h3antal);
      if (h2antal === 0) console.log('  ADVARSEL: Ingen h2 tags i optimeret tekst!');

      // Opdater titel
      const titelFelt = page.locator('#ctl00_MainContent_TbTitle');
      if (await titelFelt.count() > 0) {
        await titelFelt.click({ clickCount: 3 });
        await page.keyboard.press('Backspace');
        await titelFelt.fill(optimeret.nyTitel);
      }

      // Opdater brødtekst via Telerik editor
      if (OPTIMERTEKST && optimeret.nyBody) {
        const bodyOpdateret = await page.evaluate(function(args) {
          var resultater = [];

          // Metode 1: Telerik editor control API
          try {
            var editors = document.querySelectorAll('.RadEditor');
            editors.forEach(function(e) {
              if (e.control && typeof e.control.set_html === 'function') {
                e.control.set_html(args.html);
                resultater.push('RadEditor.set_html OK');
              }
            });
          } catch(e) { resultater.push('RadEditor fejl: ' + e.message); }

          // Metode 2: Direkte iframe manipulation
          try {
            var iframes = document.querySelectorAll('.reContentCell iframe, .RadEditor iframe');
            iframes.forEach(function(iframe) {
              if (iframe.contentDocument && iframe.contentDocument.body) {
                iframe.contentDocument.body.innerHTML = args.html;
                resultater.push('iframe OK');
              }
            });
          } catch(e) { resultater.push('iframe fejl: ' + e.message); }

          // Metode 3: Hidden textarea (backup)
          var el = document.getElementById(args.id);
          if (el) {
            el.value = args.html;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            resultater.push('textarea OK');
          }

          return resultater.join(', ');
        }, { id: 'ctl00_MainContent_EdtBodyContentHiddenTextarea', html: optimeret.nyBody });

        console.log('  OK: Brødtekst opdateret via: ' + bodyOpdateret);
        await page.waitForTimeout(500);
      }

      // Opdater dato til dags dato
      const dagsDato = new Date().toLocaleDateString('da-DK', {
        day: '2-digit', month: '2-digit', year: 'numeric'
      });
      const datoFelt = page.locator('#ctl00_MainContent_DpCreatedDate_dateInput');
      if (await datoFelt.count() > 0) {
        await datoFelt.click({ clickCount: 3 });
        await page.keyboard.press('Backspace');
        await datoFelt.fill(dagsDato);
        await datoFelt.press('Tab');
        await page.waitForTimeout(500);
        console.log('  OK: Dato opdateret: ' + dagsDato);
      }

      // Gem
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => {}),
        page.click('#ctl00_MainContent_BtnSave'),
      ]);
      console.log('  OK: Gemt!');
      totalOpdateret++;

      // Gem i log-fil
      const logEfter = await laesLogAsync();
      logEfter.behandlet.push(TYPE + ':' + item.id);
      await gemLog(logEfter);

      await page.waitForTimeout(1500);

    } catch(e) {
      console.log('  Fejl: ' + e.message);
      totalSprungetOver++;
    }
  }

  await browser.close();

  console.log('\n' + '='.repeat(50));
  console.log('FAERDIG!');
  console.log('Opdateret:     ' + totalOpdateret);
  console.log('Sprunget over: ' + totalSprungetOver);
  console.log('='.repeat(50) + '\n');

})().catch(err => {
  console.error('\nFejl: ' + err.message);
  process.exit(1);
});
