// ret-gamle.js
// Gennemgaar alle eksisterende artikler/blogs og:
// 1. Genererer bedre H1/titel via Claude
// 2. Optimerer brødtekst med bedre H2/H3 struktur
// 3. Opdaterer dato til dags dato
// Brug: node ret-gamle.js --type artikel --max 5

import 'dotenv/config';
import { chromium } from 'playwright';
import fetch from 'node-fetch';
import minimist from 'minimist';
import { assertRequiredEnv, parsePositiveInt } from './security.js';

const args = minimist(process.argv.slice(2));
const TYPE     = args.type || 'artikel';
const MAX      = parsePositiveInt(args.max, 'max', 999);
const DRY      = args.dry  === true;
// Auto-detekter Linux-server uden DISPLAY (ingen XServer) -> tving headless
const erLinuxServer = process.platform === 'linux' && !process.env.DISPLAY;
const HEADLESS = args.headless === true || erLinuxServer;
const OPTIMERTEKST = args.optimertekst !== false; // standard: optimer tekst

const { LOGIN_URL, ADMIN_URL, USERNAME, PASSWORD, ANTHROPIC_API_KEY } = process.env;
assertRequiredEnv(['LOGIN_URL', 'ADMIN_URL', 'USERNAME', 'PASSWORD', 'ANTHROPIC_API_KEY']);

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

// Hjaelper: slugify et ord til URL (matcher escort5.dk's slug-konvention)
function slugify(s) {
  return (s || '').toString().toLowerCase()
    .replace(/æ/g, 'ae').replace(/ø/g, 'oe').replace(/å/g, 'aa')
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// Generer SEO-optimeret titel og betydning for ordbogs-indlaeg via Claude
// ordbogsListe: array af { word, slug } - bruges til interne links (relaterede opslag)
async function optimerOrdbog(titel, intro, body, ordbogsListe = []) {
  const erSvensk = (process.env.SITE_URL || '').includes('.se');
  const sprog = erSvensk ? 'svensk' : 'dansk';
  const baseUrl = erSvensk ? 'https://escort.se' : 'https://escort5.dk';

  // Filtrer og begraens listen af relaterede opslag (max 60 for prompt-stoerrelse)
  const aktuelSlug = slugify(titel);
  const kandidater = (ordbogsListe || [])
    .filter(o => o && o.word && o.slug && o.slug !== aktuelSlug)
    .slice(0, 60);

  const linksListe = kandidater.length > 0
    ? kandidater.map(o => `- "${o.word}" -> ${baseUrl}/ordbog/${o.slug}`).join('\n')
    : '(ingen relaterede opslag tilgaengelige - undlad sektionen "Relaterede opslag")';

  const prompt = `Du er SEO-skribent og leksikograf for en ${sprog} escort/massage-ordbog.
Optimer dette ordbogs-opslag efter moderne SEO best practices (2025): direkte svar (featured snippet), klar struktur, intern linking.

OPSLAGSORD: "${titel}"
NUVAERENDE INTRO: "${(intro || '').substring(0, 300)}"
NUVAERENDE INDHOLD:
${(body || 'Ingen tekst').substring(0, 2000)}

TILGAENGELIGE ANDRE ORDBOGS-OPSLAG TIL INTERNE LINKS:
${linksListe}

GENERER FOELGENDE:

1) TITEL (50-65 tegn) - spoergsmaal-format for featured snippets:
   Format: "[opslagsordet] — [kort spoergsmaal eller beskrivelse]"
   Eksempler:
   - "69 stillingen — hvad er det?"
   - "Diskret — hvad betyder det?"
   - "GFE — hvad daekker det over?"

2) BROEDTEKST som HTML (200-350 ord) i denne PRAECISE struktur:

   <p>[Direkte svar paa 2-3 saetninger der svarer paa "hvad er ${titel}?". Skal vaere snippet-egnet og naevne opslagsordet i foerste saetning]</p>

   <h2>Saadan bruges ${titel}</h2>
   <p>[Praktisk forklaring af hvordan ordet/begrebet bruges - 2-4 saetninger]</p>

   <h2>Variationer og relaterede begreber</h2>
   <p>[3-5 variationer eller naert beslaegtede begreber - kort beskrevet i loebende prosa, ikke punktopstilling]</p>

   <h2>Relaterede opslag</h2>
   <p>${kandidater.length > 0 ? 'Vaelg 3-5 MEST relevante opslag fra listen ovenfor og lav HTML-links: <a href="' + baseUrl + '/ordbog/[slug]">[ord]</a>. Brug KUN ord fra listen, opfind ikke nye links. Skriv som loebende tekst, fx: "Se ogsaa ord1, ord2 og ord3."' : 'Spring denne sektion over - ingen relaterede opslag tilgaengelige.'}</p>

REGLER:
- Naturligt ${sprog}, ingen AI-klicheer, ingen "i denne artikel" eller "lad os se paa"
- Ingen <h1> i body (titlen er allerede H1)
- Ingen markdown - KUN rene HTML-tags (p, h2, a)
- Naevn opslagsordet flere gange naturligt for SEO
- Direkte svar i foerste p-tag SKAL begynde med eller tidligt naevne ${titel}
${kandidater.length > 0 ? '- Interne links: brug PRAECIS det format ' + baseUrl + '/ordbog/[slug] som givet i listen. Opfind aldrig links.' : ''}

Returner KUN et rent JSON-objekt uden markdown backticks:
{
  "nyTitel": "den nye titel i spoergsmaal-format",
  "nyBody": "broedteksten som HTML med <p> direkte svar + 3 x <h2> sektioner med <p>"
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
      max_tokens: 1500,
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
  let parsed;
  try {
    parsed = JSON.parse(renTekst);
  } catch {
    throw new Error('Claude API fejl: ugyldigt JSON-svar');
  }
  if (typeof parsed.nyTitel !== 'string' || typeof parsed.nyBody !== 'string') {
    throw new Error('Claude API fejl: manglende felter nyTitel/nyBody');
  }
  return parsed;
}

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

  if (!res.ok) {
    const errorBody = await res.text().catch(() => '');
    throw new Error('Claude API HTTP fejl: ' + res.status + ' ' + res.statusText + (errorBody ? ' - ' + errorBody.slice(0, 200) : ''));
  }
  const data = await res.json();
  if (data.error) throw new Error('Claude API fejl: ' + data.error.message);
  if (!Array.isArray(data.content)) throw new Error('Claude API fejl: uventet svarformat');
  const tekst = data.content.map(b => b.text || '').join('').trim();
  const renTekst = tekst.replace(/```json|```/g, '').trim();
  let parsed;
  try {
    parsed = JSON.parse(renTekst);
  } catch {
    throw new Error('Claude API fejl: ugyldigt JSON-svar');
  }
  if (typeof parsed.nyTitel !== 'string' || typeof parsed.nyBody !== 'string') {
    throw new Error('Claude API fejl: manglende felter nyTitel/nyBody');
  }
  return parsed;
}

(async () => {
  console.log('\n================================================');
  console.log('  ret-gamle.js — Opdater eksisterende indlaeg');
  console.log('================================================');
  console.log('Type: ' + TYPE + ' | Max: ' + MAX + (DRY ? ' | DRY-RUN' : '') + (OPTIMERTEKST ? ' | Med tekstoptimering' : ''));
  console.log('');

  const browser = await chromium.launch({ headless: HEADLESS, slowMo: 50 });
  const page = await browser.newPage();

  // Auto-accepter alle dialog-popups (bekraeftelses-vinduer mv.)
  page.on('dialog', async dialog => {
    console.log('  Dialog vist: "' + dialog.message().substring(0, 80) + '" - accepterer');
    try { await dialog.accept(); } catch(_) {}
  });

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

      // Optimer via Claude — vaelg prompt baseret paa type
      const erOrdbog = TYPE.toLowerCase() === 'ordbog';

      // For ordbog: byg liste af alle andre ordbogs-ord til interne links
      let ordbogsListe = [];
      if (erOrdbog) {
        ordbogsListe = indlaeg
          .map(it => ({ word: it.tekst, slug: slugify(it.tekst) }))
          .filter(o => o.word && o.slug && o.slug !== slugify(item.tekst));
        console.log('  Relaterede opslag tilgaengelige: ' + ordbogsListe.length);
      }

      const optimeret = erOrdbog
        ? await optimerOrdbog(nuvaerende.titel, nuvaerende.intro, nuvaerende.body, ordbogsListe)
        : await optimerIndlaeg(nuvaerende.titel, nuvaerende.intro, nuvaerende.body);
      console.log('  Ny titel:     ' + optimeret.nyTitel + ' (' + optimeret.nyTitel.length + ' tegn)');
      const h2antal = (optimeret.nyBody.match(/<h2/gi) || []).length;
      const h3antal = (optimeret.nyBody.match(/<h3/gi) || []).length;
      const ordAntal = (optimeret.nyBody.replace(/<[^>]+>/g, ' ').trim().split(/\s+/).filter(Boolean)).length;
      const linkAntal = (optimeret.nyBody.match(/<a\s+[^>]*href=/gi) || []).length;
      console.log('  Ny tekst:     ' + optimeret.nyBody.length + ' tegn | ' + ordAntal + ' ord | h2: ' + h2antal + ' | h3: ' + h3antal + (erOrdbog ? ' | interne links: ' + linkAntal : ''));
      if (h2antal === 0) console.log('  ADVARSEL: Ingen h2 tags i optimeret tekst!');
      if (erOrdbog && (ordAntal < 150 || ordAntal > 400)) console.log('  ADVARSEL: Ordbogs-tekst udenfor maal-laengde 200-350 ord (' + ordAntal + ' ord)');
      if (erOrdbog && ordbogsListe.length > 0 && linkAntal < 2) console.log('  ADVARSEL: Faa interne links (' + linkAntal + ') - forventede 3-5');

      // Opdater titel — ordbog bruger TbImageText (UI: "Titel"), artikel/blog bruger TbTitle
      const titelFeltId = erOrdbog
        ? 'ctl00_MainContent_TbImageText'
        : 'ctl00_MainContent_TbTitle';
      const titelFelt = page.locator('#' + titelFeltId);
      // Laes baseline FOER opdatering saa vi kan skelne ml. "save fejlede" og "form viser andet indlaeg"
      const titelFoer = await page.evaluate((id) => {
        const el = document.getElementById(id);
        return el ? el.value : null;
      }, titelFeltId);
      if (await titelFelt.count() > 0) {
        await titelFelt.click({ clickCount: 3 });
        await page.keyboard.press('Backspace');
        await titelFelt.fill(optimeret.nyTitel);
        console.log('  OK: Titel skrevet til ' + (erOrdbog ? 'TbImageText (ordbog)' : 'TbTitle') + ' (baseline: "' + (titelFoer || '').substring(0, 40) + '")');
      } else {
        console.log('  ADVARSEL: Titel-felt ikke fundet: ' + titelFeltId);
      }

      // Opdater brødtekst via Telerik editor
      if (OPTIMERTEKST && optimeret.nyBody) {
        const bodyOpdateret = await page.evaluate(function(args) {
          var resultater = [];

          // Metode 1: Telerik editor control API (autoritativ — Telerik laeser selv her ved submit)
          try {
            var editors = document.querySelectorAll('.RadEditor');
            editors.forEach(function(e) {
              if (e.control && typeof e.control.set_html === 'function') {
                e.control.set_html(args.html);
                // Tving editorens interne tilstand til at vaere "dirty" saa submit-handleren bruger nyt indhold
                try {
                  if (typeof e.control.get_textArea === 'function') {
                    var ta = e.control.get_textArea();
                    if (ta) ta.value = args.html;
                  }
                } catch(_) {}
                resultater.push('RadEditor.set_html OK');
              }
            });
          } catch(e) { resultater.push('RadEditor fejl: ' + e.message); }

          // Metode 2: Direkte iframe manipulation (synlig i UI)
          try {
            var iframes = document.querySelectorAll('.reContentCell iframe, .RadEditor iframe');
            iframes.forEach(function(iframe) {
              if (iframe.contentDocument && iframe.contentDocument.body) {
                iframe.contentDocument.body.innerHTML = args.html;
                resultater.push('iframe OK');
              }
            });
          } catch(e) { resultater.push('iframe fejl: ' + e.message); }

          // Metode 3: Hidden textarea (det der reelt postes til server)
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

        // Gentag: lige FØR save tvinger vi den skjulte textarea + iframe igen,
        // i tilfaelde af at Telerik har overskrevet ved en mellemliggende handling
        await page.evaluate(function(args) {
          try {
            var editors = document.querySelectorAll('.RadEditor');
            editors.forEach(function(e) {
              if (e.control && typeof e.control.set_html === 'function') e.control.set_html(args.html);
            });
          } catch(_) {}
          var el = document.getElementById(args.id);
          if (el) { el.value = args.html; el.dispatchEvent(new Event('change', { bubbles: true })); }
        }, { id: 'ctl00_MainContent_EdtBodyContentHiddenTextarea', html: optimeret.nyBody });
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

      // Sikker filnavn for screenshots
      const skrm = (s) => (s || '').toLowerCase()
        .replace(/æ/g, 'ae').replace(/ø/g, 'oe').replace(/å/g, 'aa')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 40) || 'item';
      const slugFil = skrm(item.tekst);

      // Screenshot FOER save - til debugging
      try {
        await page.screenshot({ path: 'debug-' + TYPE + '-' + slugFil + '-foer.png', fullPage: true });
        console.log('  Screenshot foer save: debug-' + TYPE + '-' + slugFil + '-foer.png');
      } catch(_) {}

      // Gem
      const urlFoer = page.url();
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => {}),
        page.click('#ctl00_MainContent_BtnSave'),
      ]);
      // Ekstra ventetid for AJAX-postback
      await page.waitForTimeout(2500);
      try { await page.waitForLoadState('networkidle', { timeout: 5000 }); } catch(_) {}

      // Screenshot EFTER save
      try {
        await page.screenshot({ path: 'debug-' + TYPE + '-' + slugFil + '-efter.png', fullPage: true });
      } catch(_) {}

      // Verificer at saven virkede ved at laese titlen tilbage fra det felt vi opdaterede
      const titelEfter = await page.evaluate((id) => {
        const el = document.getElementById(id);
        return el ? el.value : null;
      }, titelFeltId);

      const urlEfter = page.url();
      const nyTitelTrim = optimeret.nyTitel.trim();
      const titelEfterTrim = (titelEfter || '').trim();
      const titelFoerTrim = (titelFoer || '').trim();

      let saveOK = false;
      let saveStatus = '';

      if (titelEfter === null) {
        // Form er forsvundet — sandsynligvis navigeret vaek = save lykkedes
        saveOK = true;
        saveStatus = 'navigeret vaek fra form: ' + urlEfter;
      } else if (titelEfterTrim === nyTitelTrim) {
        // Forventet match: vi gemte og formularen viser den nye titel
        saveOK = true;
        saveStatus = 'titel verificeret paa form';
      } else if (titelEfterTrim === titelFoerTrim) {
        // Form viser den GAMLE vaerdi: save persisterede IKKE
        saveOK = false;
        saveStatus = 'form viser ORIGINALE vaerdi - save fejlede';
      } else {
        // Form viser noget andet — sandsynligvis et andet indlaeg blev loadet efter save
        // Re-verificer ved at navigere tilbage og finde indlaegget igen
        console.log('  Re-verificerer ved at navigere tilbage til indlaegget...');
        try {
          await page.goto(ADMIN_URL, { waitUntil: 'networkidle' });
          const kb2 = page.locator(katSelector);
          if (await kb2.count() > 0) {
            await kb2.click();
            await page.waitForLoadState('networkidle').catch(() => {});
            await page.waitForTimeout(800);
          }
          const renTekst2 = item.tekst.replace(/[.?!]/g, '').trim();
          const fandt2 = await page.evaluate((soege) => {
            const its = Array.from(document.querySelectorAll('li.rlbItem'));
            for (let i = 0; i < its.length; i++) {
              const summ = its[i].querySelector('.summery');
              const slug = summ ? summ.textContent.trim() : '';
              const ful = (its[i].textContent || '').replace(/\s+/g, ' ').trim();
              let t = ful;
              if (slug && ful.toLowerCase().endsWith(slug.toLowerCase())) {
                t = ful.slice(0, ful.length - slug.length).trim();
              }
              const tl = t.toLowerCase(), sl = soege.toLowerCase();
              if (tl.includes(sl) || sl.includes(tl.substring(0, Math.min(tl.length, 20)))) {
                its[i].click();
                return true;
              }
            }
            return false;
          }, renTekst2);

          if (fandt2) {
            try { await page.waitForSelector('#' + titelFeltId, { timeout: 6000 }); } catch(_) {}
            await page.waitForTimeout(1200);
            const titelGenLaest = await page.evaluate((id) => {
              const el = document.getElementById(id);
              return el ? el.value : null;
            }, titelFeltId);
            if (titelGenLaest && titelGenLaest.trim() === nyTitelTrim) {
              saveOK = true;
              saveStatus = 're-verificeret efter genaabning af indlaeg';
            } else {
              saveOK = false;
              saveStatus = 're-verifikation fejlede - feltet indeholder: "' + (titelGenLaest || '').substring(0, 60) + '"';
            }
          } else {
            saveOK = false;
            saveStatus = 'kunne ikke finde indlaegget ved re-verifikation';
          }
        } catch(e) {
          saveOK = false;
          saveStatus = 're-verifikation fejlede med fejl: ' + e.message;
        }
      }

      if (saveOK) {
        console.log('  OK: Gemt! (' + saveStatus + ')');
      } else {
        console.log('  ADVARSEL: Save lykkedes IKKE - ' + saveStatus);
        console.log('           Forventet titel: ' + nyTitelTrim.substring(0, 60));
        console.log('           Form efter save: ' + (titelEfterTrim || '(tom)').substring(0, 60));
        console.log('           Baseline (foer): ' + titelFoerTrim.substring(0, 60));
        console.log('           Tjek screenshots: debug-' + TYPE + '-' + slugFil + '-{foer,efter}.png');
        totalSprungetOver++;
        await page.waitForTimeout(1000);
        continue;
      }

      totalOpdateret++;

      // Gem i log-fil (kun hvis vi tror save lykkedes)
      const logEfter = await laesLogAsync();
      const logKey = TYPE + ':' + item.id;
      if (!logEfter.behandlet.includes(logKey)) logEfter.behandlet.push(logKey);
      // Gem detaljer saa log-menu kan vise menneskeligt-laesbar info
      if (!logEfter.detaljer) logEfter.detaljer = {};
      logEfter.detaljer[logKey] = {
        ord: item.tekst,
        nyTitel: optimeret.nyTitel,
        dato: new Date().toISOString()
      };
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
