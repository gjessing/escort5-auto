// escort5-auto/artikel.js
// Brug: node artikel.js --by "Kobenhavn" --emne "escort guide"

import 'dotenv/config';
import fetch from 'node-fetch';
import minimist from 'minimist';
import { assertRequiredEnv } from './security.js';
import { opretArtikelViaApi } from './billboard-api.js';

const args = minimist(process.argv.slice(2));
const BY      = args.by   || args.b || null;
const EMNE    = args.emne || args.e || null;
const EXTRA   = args.extra || '';
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
const { ANTHROPIC_API_KEY } = process.env;
assertRequiredEnv(['ANTHROPIC_API_KEY']);

async function genererArtikel(by, emne, extra) {
  console.log('\nGenererer artikel om "' + emne + '" i ' + by + '...');

  const aartal = new Date().getFullYear();
  const prompt = `Du er en SEO-skribent for escort5.dk - en dansk escort og massage guide.
Det aktuelle aar er ${aartal}. Hvis du naevner et aarstallet skal det vaere ${aartal} - aldrig et andet aar.
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
      model: 'claude-sonnet-4-6',
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
  let artikel;
  try {
    artikel = JSON.parse(tekst);
  } catch {
    throw new Error('Claude API fejl: ugyldigt JSON-svar');
  }
  const requiredFields = ['imageText', 'title', 'intro', 'body', 'meta'];
  for (const field of requiredFields) {
    if (typeof artikel[field] !== 'string' || !artikel[field].trim()) {
      throw new Error('Claude API fejl: manglende/ugyldigt felt "' + field + '"');
    }
  }

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
  console.log('\nOpretter artikel via Billboard API...');
  const billedeSti = await hentBillede(BY, EMNE);
  const link = await opretArtikelViaApi({ artikel, emne: EMNE, sprog: 'da', blog: BLOG, billedeSti });
  console.log('  OK: Artikel oprettet som kladde: ' + link);
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
