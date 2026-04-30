// log-menu.js - Administrer ret-gamle-log.json
// Brug: node log-menu.js

import { readFileSync, writeFileSync, existsSync } from 'fs';
import * as readline from 'readline';

const LOG_FIL = 'ret-gamle-log.json';

function laesLog() {
  if (!existsSync(LOG_FIL)) return { behandlet: [] };
  try { return JSON.parse(readFileSync(LOG_FIL, 'utf8')); } 
  catch(e) { return { behandlet: [] }; }
}

function gemLog(log) {
  writeFileSync(LOG_FIL, JSON.stringify(log, null, 2));
}

function sporg(sporgsmaal) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(sporgsmaal, ans => { rl.close(); resolve(ans.trim()); }));
}

async function main() {
  console.clear();
  const log = laesLog();
  const behandlet = log.behandlet || [];

  console.log('================================================');
  console.log('  Log-administration — ret-gamle-log.json');
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
      console.log('\nBehandlede indlaeg:\n');
      if (behandlet.length === 0) {
        console.log('  (ingen endnu)');
      } else {
        // Grupper efter type
        const typer = {};
        behandlet.forEach((item, i) => {
          const parts = item.split(':');
          const type = parts[0];
          if (!typer[type]) typer[type] = [];
          typer[type].push({ nr: i + 1, id: item });
        });
        Object.keys(typer).forEach(type => {
          console.log('\n' + type.toUpperCase() + ' (' + typer[type].length + '):');
          typer[type].forEach(item => {
            console.log('  ' + item.nr + '. ' + item.id);
          });
        });
      }
      break;
    }

    case '2': {
      console.log('\nNuvaerende log:');
      behandlet.forEach((item, i) => console.log('  ' + (i + 1) + '. ' + item));
      console.log('');
      const nr = await sporg('Skriv nummer der skal fjernes (eller flere separeret med komma): ');
      const numre = nr.split(',').map(n => parseInt(n.trim()) - 1).filter(n => !isNaN(n) && n >= 0 && n < behandlet.length);
      if (numre.length === 0) { console.log('Ingen gyldige numre.'); break; }
      const fjernet = numre.map(n => behandlet[n]);
      log.behandlet = behandlet.filter((_, i) => !numre.includes(i));
      gemLog(log);
      console.log('\nFjernet ' + fjernet.length + ' indlaeg:');
      fjernet.forEach(f => console.log('  - ' + f));
      console.log('De vil blive genbehandlet naeste gang du koerer ret-gamle.js');
      break;
    }

    case '3': {
      const type = await sporg('Hvilken type? (artikel/blog/ordbog): ');
      const foer = behandlet.length;
      log.behandlet = behandlet.filter(item => !item.startsWith(type.toLowerCase() + ':'));
      const fjernet = foer - log.behandlet.length;
      gemLog(log);
      console.log('\nFjernet ' + fjernet + ' ' + type + '-indlaeg fra loggen.');
      console.log('De vil alle blive genbehandlet naeste gang.');
      break;
    }

    case '4': {
      const bekraeft = await sporg('Er du sikker? Alle ' + behandlet.length + ' indlaeg nulstilles (j/n): ');
      if (bekraeft.toLowerCase() === 'j') {
        writeFileSync(LOG_FIL, JSON.stringify({ behandlet: [] }, null, 2));
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
