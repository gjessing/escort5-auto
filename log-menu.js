// log-menu.js - Administrer ret-gamle-log.json
// Brug: node log-menu.js

import { readFileSync, writeFileSync, existsSync } from 'fs';
import * as readline from 'readline';

const LOG_FIL = 'ret-gamle-log.json';

function laesLog() {
  if (!existsSync(LOG_FIL)) return { behandlet: [], detaljer: {} };
  try {
    const data = JSON.parse(readFileSync(LOG_FIL, 'utf8'));
    if (!data.detaljer) data.detaljer = {};
    if (!data.behandlet) data.behandlet = [];
    return data;
  } catch(e) { return { behandlet: [], detaljer: {} }; }
}

function gemLog(log) {
  writeFileSync(LOG_FIL, JSON.stringify(log, null, 2));
}

function sporg(sporgsmaal) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(sporgsmaal, ans => { rl.close(); resolve(ans.trim()); }));
}

// Hjaelpere til formatering
function pad(s, n) {
  s = String(s == null ? '' : s);
  if (s.length >= n) return s.substring(0, n);
  return s + ' '.repeat(n - s.length);
}

function trunc(s, n) {
  s = String(s == null || s === '' ? '-' : s);
  return s.length > n ? s.substring(0, n - 1) + '…' : s;
}

function formatDato(iso) {
  if (!iso) return '-';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '-';
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return dd + '/' + mm;
  } catch(_) { return '-'; }
}

// Ekstraher kort ID-suffix fra full id (fx "artikel:ctl00_MainContent_LbTopics_i12" -> "i12")
function kortId(fullId) {
  const idDel = (fullId.split(':')[1] || '');
  const segmenter = idDel.split('_');
  return segmenter[segmenter.length - 1] || idDel;
}

function visTabel(items, detaljer) {
  // Kolonnebredder
  const W_NR = 4;
  const W_ORD = 32;
  const W_TITEL = 48;
  const W_DATO = 6;
  const total = W_NR + W_ORD + W_TITEL + W_DATO + 3;

  // Tjek om der er mindst en post med detaljer i denne gruppe
  const harDetaljer = items.some(it => detaljer[it.id]);

  // Header
  console.log('  ' + pad('Nr', W_NR) + ' ' + pad('Ord/Emne', W_ORD) + ' ' + pad('Ny titel', W_TITEL) + ' ' + pad('Dato', W_DATO));
  console.log('  ' + '-'.repeat(total));

  // Hvis ingen i gruppen har detaljer: vis kompakt med ID-suffix
  if (!harDetaljer) {
    items.forEach(item => {
      const idKort = '(' + kortId(item.id) + ')';
      console.log('  ' + pad(String(item.nr), W_NR) + ' ' + pad(idKort, W_ORD) + ' ' + pad('-', W_TITEL) + ' ' + pad('-', W_DATO));
    });
    console.log('  ' + ' '.repeat(W_NR + 1) + '(' + items.length + ' aeldre indgange uden gemte detaljer)');
    return;
  }

  // Ellers vis fuld info hvor det findes, fallback til ID-suffix for gamle
  items.forEach(item => {
    const d = detaljer[item.id] || null;
    const ord = d && d.ord ? trunc(d.ord, W_ORD) : '(' + kortId(item.id) + ')';
    const titel = d && d.nyTitel ? trunc(d.nyTitel, W_TITEL) : '-';
    const dato = d && d.dato ? formatDato(d.dato) : '-';
    console.log('  ' + pad(String(item.nr), W_NR) + ' ' + pad(ord, W_ORD) + ' ' + pad(titel, W_TITEL) + ' ' + pad(dato, W_DATO));
  });
}

async function main() {
  console.clear();
  const log = laesLog();
  const behandlet = log.behandlet || [];
  const detaljer = log.detaljer || {};

  console.log('================================================');
  console.log('  Log-administration - ret-gamle-log.json');
  console.log('================================================');
  console.log('  Behandlede indlaeg: ' + behandlet.length);
  console.log('');
  console.log('  1. Vis alle behandlede indlaeg');
  console.log('  2. Fjern enkelt indlaeg (genbehandl)');
  console.log('  3. Fjern alle af en type (artikel/blog/ordbog)');
  console.log('  4. Nulstil hele loggen');
  console.log('  5. Afslut');
  console.log('');

  const valg = await sporg('Vaelg (1-5): ');

  switch(valg) {
    case '1': {
      console.log('\nBehandlede indlaeg:');
      if (behandlet.length === 0) {
        console.log('  (ingen endnu)\n');
        break;
      }

      // Grupper efter type
      const typer = {};
      behandlet.forEach((id, i) => {
        const type = (id.split(':')[0] || 'ukendt').toLowerCase();
        if (!typer[type]) typer[type] = [];
        typer[type].push({ nr: i + 1, id });
      });

      // Vis hver type i alfabetisk raekkefoelge
      Object.keys(typer).sort().forEach(type => {
        console.log('\n' + type.toUpperCase() + ' (' + typer[type].length + '):');
        visTabel(typer[type], detaljer);
      });
      console.log('');
      break;
    }

    case '2': {
      // Vis listen kompakt med tabel
      const typer = {};
      behandlet.forEach((id, i) => {
        const type = (id.split(':')[0] || 'ukendt').toLowerCase();
        if (!typer[type]) typer[type] = [];
        typer[type].push({ nr: i + 1, id });
      });
      console.log('\nNuvaerende log:');
      Object.keys(typer).sort().forEach(type => {
        console.log('\n' + type.toUpperCase() + ' (' + typer[type].length + '):');
        visTabel(typer[type], detaljer);
      });
      console.log('');

      const nr = await sporg('Skriv nummer der skal fjernes (eller flere separeret med komma, fx 48,49,50): ');
      const numre = nr.split(',').map(n => parseInt(n.trim()) - 1).filter(n => !isNaN(n) && n >= 0 && n < behandlet.length);
      if (numre.length === 0) { console.log('Ingen gyldige numre.'); break; }

      const fjernet = numre.map(n => ({ id: behandlet[n], detalje: detaljer[behandlet[n]] || null }));
      log.behandlet = behandlet.filter((_, i) => !numre.includes(i));
      // Ryd detaljer for fjernede
      fjernet.forEach(f => { delete log.detaljer[f.id]; });
      gemLog(log);

      console.log('\nFjernet ' + fjernet.length + ' indlaeg:');
      fjernet.forEach(f => {
        const navn = f.detalje && f.detalje.ord ? '"' + f.detalje.ord + '"' : f.id;
        console.log('  - ' + navn);
      });
      console.log('De vil blive genbehandlet naeste gang du koerer ret-gamle.js');
      break;
    }

    case '3': {
      const type = (await sporg('Hvilken type? (artikel/blog/ordbog): ')).toLowerCase();
      if (!['artikel', 'blog', 'ordbog', 'startside'].includes(type)) {
        console.log('Ugyldig type.');
        break;
      }
      const foer = behandlet.length;
      const fjernedeIds = behandlet.filter(id => id.startsWith(type + ':'));
      log.behandlet = behandlet.filter(id => !id.startsWith(type + ':'));
      // Ryd detaljer
      fjernedeIds.forEach(id => { delete log.detaljer[id]; });
      const fjernet = foer - log.behandlet.length;
      gemLog(log);

      console.log('\nFjernet ' + fjernet + ' ' + type + '-indlaeg fra loggen.');
      // Vis evt. ord der blev fjernet hvis vi har detaljer
      const ordListe = fjernedeIds
        .map(id => detaljer[id] && detaljer[id].ord)
        .filter(Boolean);
      if (ordListe.length > 0) {
        console.log('Ord/emner: ' + ordListe.slice(0, 10).join(', ') + (ordListe.length > 10 ? '...' : ''));
      }
      console.log('De vil alle blive genbehandlet naeste gang.');
      break;
    }

    case '4': {
      const bekraeft = await sporg('Er du sikker? Alle ' + behandlet.length + ' indlaeg nulstilles (j/n): ');
      if (bekraeft.toLowerCase() === 'j') {
        writeFileSync(LOG_FIL, JSON.stringify({ behandlet: [], detaljer: {} }, null, 2));
        console.log('\nLoggen er nulstillet - alle indlaeg behandles igen naeste gang.');
      } else {
        console.log('Annulleret.');
      }
      break;
    }

    case '5':
      console.log('\nFarvel!\n');
      process.exit(0);

    default:
      console.log('\nUgyldigt valg.');
  }

  console.log('');
  const fortsaet = await sporg('Tilbage til menuen? (j/n): ');
  if (fortsaet.toLowerCase() === 'j' || fortsaet === '') await main();
  else console.log('\nFarvel!\n');
}

main().catch(err => {
  console.error('Fejl: ' + err.message);
  process.exit(1);
});
