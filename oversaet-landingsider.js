// oversaet-landingsider.js – oversætter landingssider til de andre sprog på sitet via Billboards API.
// escort.se: svensk (sv) -> engelsk (en) og dansk (da). escort5.dk: dansk (da) -> engelsk (en) og svensk (sv).
// Skriver kun de sprog, der mangler. Eksisterende tekst røres ikke.
// Brug:
//   node --env-file=.env oversaet-landingsider.js --dry        (viser hvad der ville blive gemt)
//   node --env-file=.env oversaet-landingsider.js --max 1      (gemmer for højst 1 landingsside)

import 'dotenv/config';
import minimist from 'minimist';
import { assertRequiredEnv, parsePositiveInt } from './security.js';

const args = minimist(process.argv.slice(2));
const MAX = parsePositiveInt(args.max, 'max', 999);
const DRY = args.dry === true;
const SITE = process.env.SITE_URL || 'https://escort.se/';
const ER_SVENSK_SITE = SITE.includes('.se');
const KILDE = ER_SVENSK_SITE ? 'sv' : 'da';
const MAAL = ER_SVENSK_SITE ? ['en', 'da'] : ['en', 'sv'];
const SPROGNAVN = { en: 'engelsk', da: 'dansk', sv: 'svensk' };
const FELTER = ['title', 'pageTitle', 'metaDescription', 'intro', 'body', 'imageText'];

assertRequiredEnv(['BILLBOARD_API_KEY', 'ANTHROPIC_API_KEY']);

async function api(sti, options = {}) {
  const res = await fetch(new URL('/api/ext/v1/topics' + sti, SITE), {
    ...options,
    headers: {
      Authorization: 'Bearer ' + process.env.BILLBOARD_API_KEY,
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const tekst = await res.text().catch(() => '');
    throw new Error('Billboard API HTTP ' + res.status + ' ' + res.statusText + (tekst ? ' - ' + tekst.slice(0, 300) : ''));
  }
  return res.status === 204 ? null : res.json();
}

async function oversaet(kilde) {
  const malListe = MAAL.map(s => SPROGNAVN[s] + ' (' + s + ')').join(' og ');
  const eksempel = MAAL.map(s => '"' + s + '": {"title": "", "pageTitle": "", "metaDescription": "", "intro": "", "body": "", "imageText": ""}').join(', ');
  const prompt = `Oversæt denne ${SPROGNAVN[KILDE]} landingsside til ${malListe}.
Bevar HTML-tags i body og intro. Oversæt ikke bynavne eller navne. Skriv naturligt og i samme tone.
Intro må højst være 256 tegn.

Svar KUN med et rent JSON-objekt i dette format:
{${eksempel}}

${SPROGNAVN[KILDE][0].toUpperCase() + SPROGNAVN[KILDE].slice(1)} kilde:
${FELTER.map(f => f + ': ' + (kilde[f] ?? '')).join('\n')}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
      max_tokens: 8000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) {
    const tekst = await res.text().catch(() => '');
    throw new Error('Claude API HTTP fejl: ' + res.status + ' ' + res.statusText + (tekst ? ' - ' + tekst.slice(0, 200) : ''));
  }
  const data = await res.json();
  if (data.error) throw new Error('Claude API fejl: ' + data.error.message);
  const tekst = (data.content || []).map(b => b.text || '').join('').trim().replace(/```json|```/g, '').trim();

  let oversat;
  try {
    oversat = JSON.parse(tekst);
  } catch {
    throw new Error('Claude API fejl: ugyldigt JSON-svar');
  }
  for (const sprog of MAAL) {
    if (!oversat[sprog] || !oversat[sprog].title) {
      throw new Error('Oversættelsen mangler titel for ' + sprog);
    }
    oversat[sprog].body = oversat[sprog].body || '';
    if (oversat[sprog].intro && oversat[sprog].intro.length > 256) {
      oversat[sprog].intro = oversat[sprog].intro.substring(0, 253) + '...';
    }
  }
  return oversat;
}

(async () => {
  try {
    const liste = await api('?category=LandingPage');
    const mangler = liste.filter(t => t.titles && t.titles[KILDE] && MAAL.some(s => !t.titles[s]));
    console.log('Landingssider med ' + KILDE + '-tekst og manglende sprog: ' + mangler.length);

    let gemt = 0;
    for (const item of mangler) {
      if (gemt >= MAX) break;
      const fuld = await api('/LandingPage/' + encodeURIComponent(item.topicId));
      const kilde = fuld.texts && fuld.texts[KILDE];
      if (!kilde || !kilde.title) {
        console.log('\nSpringer over: ' + item.topicId + ' har ingen ' + KILDE + '-titel');
        continue;
      }

      const mangelSprog = MAAL.filter(s => !(fuld.texts && fuld.texts[s]));
      if (mangelSprog.length === 0) continue;

      console.log('\nOversætter: ' + item.topicId + ' (mangler: ' + mangelSprog.join(', ') + ')');
      let oversat;
      try {
        oversat = await oversaet(kilde);
      } catch (err) {
        console.log('  Springer over: ' + err.message);
        continue;
      }

      const texts = {};
      for (const s of mangelSprog) texts[s] = oversat[s];

      if (DRY) {
        console.log('  DRY: ville gemme ' + JSON.stringify(texts).slice(0, 300) + '...');
      } else {
        await api('/' + fuld.topicGuid, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ texts }),
        });
        console.log('  OK: gemt ' + mangelSprog.join(', ') + ' for ' + item.link);
      }
      gemt++;
    }
    console.log('\nFærdig. ' + gemt + ' landingsside(r) ' + (DRY ? 'vurderet (dry-run).' : 'oversat.'));
  } catch (err) {
    console.error('\nFejl: ' + err.message);
    process.exit(1);
  }
})();
