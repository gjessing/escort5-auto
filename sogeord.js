// sogeord.js
// Henter sogeord fra Google Search Console med hoj visning men lav CTR
// Brug: node sogeord.js
// Eller: node sogeord.js --antal 10 --dage 90

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
process.emitWarning = (warning, ...args) => { if (String(warning).includes('NODE_TLS')) return; require('events').EventEmitter.prototype.emit.call(process, 'warning', warning, ...args); };

import 'dotenv/config';
import { google } from 'googleapis';
import minimist from 'minimist';

const args = minimist(process.argv.slice(2));
const ANTAL = args.antal || 10;
const DAGE  = args.dage  || 90;
const SITE  = process.env.SITE_URL || 'https://escort5.dk/';
const LONGTAIL_MIN_ORD = args.minOrd || 3;
const MIN_IMPRESSIONS = args.minVisninger || 10;
const JSON_OUTPUT = Boolean(args.json);

function log(...messages) {
  if (!JSON_OUTPUT) {
    console.log(...messages);
  }
}

function antalOrd(query) {
  return String(query)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .length;
}

async function hentSogeord() {
  log('\nHenter sogeord fra Google Search Console...');
  log('Site: ' + SITE);
  log('Periode: de seneste ' + DAGE + ' dage\n');

  // Autentificer med service account
  const auth = new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_CREDENTIALS || 'google-credentials.json',
    scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
  });

  const searchconsole = google.searchconsole({ version: 'v1', auth });

  // Beregn dato-interval
  const slutDato = new Date();
  const startDato = new Date();
  startDato.setDate(slutDato.getDate() - DAGE);

  const format = d => d.toISOString().split('T')[0];

  // Hent sogeord data
  const res = await searchconsole.searchanalytics.query({
    siteUrl: SITE,
    requestBody: {
      startDate: format(startDato),
      endDate: format(slutDato),
      dimensions: ['query'],
      rowLimit: 500,
      dimensionFilterGroups: [{
        filters: [{
          dimension: 'country',
          operator: 'equals',
          expression: 'dnk'
        }]
      }]
    }
  });

  const rows = res.data.rows || [];
  if (rows.length === 0) {
    if (JSON_OUTPUT) {
      console.log(JSON.stringify({ success: true, muligheder: [] }, null, 2));
      return;
    }
    log('Ingen data fundet. Tjek at service account har adgang til Search Console.');
    return;
  }

  // Filtrer og sorter long tail-sogeord fra Search Console.
  const muligheder = rows
    .map((r) => {
      const query = r.keys?.[0] || '';
      const ord = antalOrd(query);
      const longtailScore = (r.impressions * (1 - r.ctr)) + (ord * 25) + (Math.max(r.position - 3, 0) * 10);
      return { ...r, query, ord, longtailScore };
    })
    .filter((r) =>
      r.query &&
      r.ord >= LONGTAIL_MIN_ORD &&
      r.impressions >= MIN_IMPRESSIONS &&
      r.ctr < 0.1 &&
      r.position > 3
    )
    .sort((a, b) => b.longtailScore - a.longtailScore)
    .slice(0, ANTAL);

  if (muligheder.length === 0) {
    if (JSON_OUTPUT) {
      console.log(JSON.stringify({ success: true, muligheder: [] }, null, 2));
      return;
    }
    log('Ingen gode long tail muligheder fundet med de nuvaerende filtre.');
    log('Proev med: node sogeord.js --dage 180 --minVisninger 5 --minOrd 2');
    return;
  }

  if (JSON_OUTPUT) {
    console.log(JSON.stringify({
      success: true,
      muligheder: muligheder.map((r, i) => ({
        nr: i + 1,
        query: r.query,
        ord: r.ord,
        impressions: Math.round(r.impressions),
        ctr: Number((r.ctr * 100).toFixed(1)),
        position: Number(r.position.toFixed(1))
      }))
    }, null, 2));
    return;
  }

  log(`TOP LONG TAIL SOGEORD (min. ${LONGTAIL_MIN_ORD} ord):`);
  log('='.repeat(76));
  log('Nr  | Sogeord                          | Ord | Vis.  | CTR  | Pos.');
  log('-'.repeat(76));

  muligheder.forEach((r, i) => {
    const nr    = String(i + 1).padStart(2);
    const query = r.query.padEnd(32).substring(0, 32);
    const ord   = String(r.ord).padStart(3);
    const imp   = String(Math.round(r.impressions)).padStart(5);
    const ctr   = (r.ctr * 100).toFixed(1).padStart(4) + '%';
    const pos   = r.position.toFixed(1).padStart(5);
    log(nr + '  | ' + query + ' | ' + ord + ' | ' + imp + ' | ' + ctr + ' | ' + pos);
  });

  log('='.repeat(76));
  log('\nBrug et sogeord direkte:');
  log('node artikel.js --by "by" --emne "' + muligheder[0].query + '"');
  log('\nEller generer automatisk fra top sogeord:');
  log('node auto.js');
}

hentSogeord().catch(err => {
  console.error('\nFejl: ' + err.message);
  if (err.message.includes('invalid_grant')) {
    console.error('Tjek at google-credentials.json er korrekt og har adgang til Search Console');
  }
  process.exit(1);
});
