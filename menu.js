// menu.js - Simpel menu til escort5-auto
// Brug: node menu.js

import * as readline from 'readline';
import {
  parsePercent,
  parsePositiveInt,
  runNodeScript,
  sanitizeLabel,
  validateHttpUrl
} from './security.js';

function sporg(sporgsmaal) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(sporgsmaal, ans => { rl.close(); resolve(ans.trim()); }));
}

function kor(script, args = []) {
  runNodeScript(script, args);
}

async function main() {
  console.clear();
  console.log('================================================');
  console.log('   escort5-auto — Artikel Generator');
  console.log('================================================');
  console.log('');
  console.log('  1. Generer artikel automatisk (fra sogeord)');
  console.log('  2. Generer blog automatisk (fra sogeord)');
  console.log('  3. Generer artikel manuelt (vaelg by og emne)');
  console.log('  4. Generer blog manuelt (vaelg by og emne)');
  console.log('  5. Se top sogeord fra Search Console');
  console.log('  6. Hent billeder fra en hjemmeside');
  console.log('  7. Find manglende byer til blog indlaeg');
  console.log('  8. Ret gamle artikler/blogs (H1 + dato)');
  console.log('  9. Administrer log (genbehandl artikler)');
  console.log('  10. Afslut');
  console.log('');

  const valg = await sporg('Vaelg en mulighed (1-7): ');

  switch(valg) {
    case '1': {
      console.log('');
      const antal = parsePositiveInt(await sporg('Hvor mange artikler? (standard: 1): '), 'antal', 1);
      const dage  = parsePositiveInt(await sporg('Sogedata fra hvor mange dage? (standard: 90): '), 'dage', 90);
      kor('auto.js', ['--antal', String(antal), '--dage', String(dage)]);
      break;
    }

    case '2': {
      console.log('');
      const antal = parsePositiveInt(await sporg('Hvor mange blogs? (standard: 1): '), 'antal', 1);
      const dage  = parsePositiveInt(await sporg('Sogedata fra hvor mange dage? (standard: 90): '), 'dage', 90);
      kor('auto.js', ['--antal', String(antal), '--dage', String(dage), '--blog']);
      break;
    }

    case '3': {
      console.log('');
      const by   = sanitizeLabel(await sporg('By (fx Kobenhavn, Aarhus): '), 'By');
      const emne = sanitizeLabel(await sporg('Emne (fx escort guide, massage): '), 'Emne');
      kor('artikel.js', ['--by', by, '--emne', emne]);
      break;
    }

    case '4': {
      console.log('');
      const by   = sanitizeLabel(await sporg('By (fx Kobenhavn, Aarhus): '), 'By');
      const emne = sanitizeLabel(await sporg('Emne (fx escort guide, massage): '), 'Emne');
      kor('artikel.js', ['--by', by, '--emne', emne, '--blog']);
      break;
    }

    case '5': {
      console.log('');
      const dage  = parsePositiveInt(await sporg('Sogedata fra hvor mange dage? (standard: 90): '), 'dage', 90);
      const antal = parsePositiveInt(await sporg('Vis hvor mange sogeord? (standard: 10): '), 'antal', 10);
      kor('sogeord.js', ['--dage', String(dage), '--antal', String(antal)]);
      break;
    }

    case '6': {
      console.log('');
      const url   = validateHttpUrl(await sporg('URL til hjemmeside: '), 'URL');
      const mappe = sanitizeLabel(await sporg('Gem i mappe (fx escort, massage, kobenhavn): ') || 'generelle', 'Mappe');
      const crop  = parsePercent(await sporg('Afskær % af bunden (standard: 3): '), 'crop', 3);
      kor('hent-billede.js', ['--url', url, '--mappe', mappe, '--crop', String(crop)]);
      break;
    }

    case '7': {
      kor('manglende-byer.js');
      break;
    }

    case '8': {
      console.log('');
      const typeInput = (await sporg('Type (artikel/blog/ordbog/alle, standard: alle): ') || 'alle').toLowerCase();
      const tilladteTyper = new Set(['artikel', 'blog', 'ordbog', 'alle']);
      const type = tilladteTyper.has(typeInput) ? typeInput : 'alle';
      const max = parsePositiveInt(await sporg('Max antal at behandle (standard: alle): '), 'max', 999);
      const dry  = await sporg('Dry-run - vis kun hvad der ville ske? (j/n): ') || 'n';
      const args = ['--type', type, '--max', String(max)];
      if (dry.toLowerCase() === 'j') args.push('--dry');
      kor('ret-gamle.js', args);
      break;
    }

    case '9': {
      kor('log-menu.js');
      break;
    }

    case '10':
      console.log('\nFarvel!\n');
      process.exit(0);

    default:
      console.log('\nUgyldigt valg - proev igen.\n');
  }

  console.log('');
  const fortsaet = await sporg('Tilbage til menuen? (j/n): ');
  if (fortsaet.toLowerCase() === 'j' || fortsaet === '') {
    await main();
  } else {
    console.log('\nFarvel!\n');
  }
}

main().catch(err => {
  console.error('Fejl: ' + err.message);
  process.exit(1);
});
