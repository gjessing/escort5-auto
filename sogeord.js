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

async function hentSogeord() {
  console.log('\nHenter sogeord fra Google Search Console...');
  console.log('Site: ' + SITE);
  console.log('Periode: de seneste ' + DAGE + ' dage\n');

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
    console.log('Ingen data fundet. Tjek at service account har adgang til Search Console.');
    return;
  }

  // Filtrer og sorter - hoj visning, lav CTR = artikelmulighed
  const muligheder = rows
    .filter(r => r.impressions >= 50 && r.ctr < 0.05 && r.position > 5)
    .sort((a, b) => (b.impressions * (1 - b.ctr)) - (a.impressions * (1 - a.ctr)))
    .slice(0, ANTAL);

  if (muligheder.length === 0) {
    console.log('Ingen gode artikelmuligheder fundet med de nuvaerende filtre.');
    console.log('Proev med: node sogeord.js --dage 180');
    return;
  }

  console.log('TOP ARTIKELMULIGHEDER (hoj visning, lav CTR):');
  console.log('='.repeat(60));
  console.log('Nr  | Sogeord                          | Vis.  | CTR  | Pos.');
  console.log('-'.repeat(60));

  muligheder.forEach((r, i) => {
    const nr    = String(i + 1).padStart(2);
    const query = r.keys[0].padEnd(32).substring(0, 32);
    const imp   = String(Math.round(r.impressions)).padStart(5);
    const ctr   = (r.ctr * 100).toFixed(1).padStart(4) + '%';
    const pos   = r.position.toFixed(1).padStart(5);
    console.log(nr + '  | ' + query + ' | ' + imp + ' | ' + ctr + ' | ' + pos);
  });

  console.log('='.repeat(60));
  console.log('\nBrug et sogeord direkte:');
  console.log('node artikel.js --by "by" --emne "' + muligheder[0].keys[0] + '"');
  console.log('\nEller generer automatisk fra top sogeord:');
  console.log('node auto.js');
}

hentSogeord().catch(err => {
  console.error('\nFejl: ' + err.message);
  if (err.message.includes('invalid_grant')) {
    console.error('Tjek at google-credentials.json er korrekt og har adgang til Search Console');
  }
  process.exit(1);
});
