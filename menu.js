// menu.js - Simpel menu til escort5-auto
// Brug: node menu.js

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
process.emitWarning = (warning, ...args) => { if (String(warning).includes('NODE_TLS')) return; require('events').EventEmitter.prototype.emit.call(process, 'warning', warning, ...args); };
import { execSync } from 'child_process';
import * as readline from 'readline';

function sporg(sporgsmaal) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(sporgsmaal, ans => { rl.close(); resolve(ans.trim()); }));
}

function kor(kommando) {
  try {
    execSync(kommando, { stdio: 'inherit' });
  } catch(e) {}
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
  console.log('  8. Afslut');
  console.log('');

  const valg = await sporg('Vaelg en mulighed (1-7): ');

  switch(valg) {
    case '1': {
      console.log('');
      const antal = await sporg('Hvor mange artikler? (standard: 1): ') || '1';
      const dage  = await sporg('Sogedata fra hvor mange dage? (standard: 90): ') || '90';
      kor(`node auto.js --antal ${antal} --dage ${dage}`);
      break;
    }

    case '2': {
      console.log('');
      const antal = await sporg('Hvor mange blogs? (standard: 1): ') || '1';
      const dage  = await sporg('Sogedata fra hvor mange dage? (standard: 90): ') || '90';
      kor(`node auto.js --antal ${antal} --dage ${dage} --blog`);
      break;
    }

    case '3': {
      console.log('');
      const by   = await sporg('By (fx Kobenhavn, Aarhus): ');
      const emne = await sporg('Emne (fx escort guide, massage): ');
      if (!by || !emne) { console.log('By og emne er paakraevet.'); break; }
      kor(`node artikel.js --by "${by}" --emne "${emne}"`);
      break;
    }

    case '4': {
      console.log('');
      const by   = await sporg('By (fx Kobenhavn, Aarhus): ');
      const emne = await sporg('Emne (fx escort guide, massage): ');
      if (!by || !emne) { console.log('By og emne er paakraevet.'); break; }
      kor(`node artikel.js --by "${by}" --emne "${emne}" --blog`);
      break;
    }

    case '5': {
      console.log('');
      const dage  = await sporg('Sogedata fra hvor mange dage? (standard: 90): ') || '90';
      const antal = await sporg('Vis hvor mange sogeord? (standard: 10): ') || '10';
      kor(`node sogeord.js --dage ${dage} --antal ${antal}`);
      break;
    }

    case '6': {
      console.log('');
      const url   = await sporg('URL til hjemmeside: ');
      const mappe = await sporg('Gem i mappe (fx escort, massage, kobenhavn): ') || 'generelle';
      const crop  = await sporg('Afskær % af bunden (standard: 3): ') || '3';
      if (!url) { console.log('URL er paakraevet.'); break; }
      kor(`node hent-billede.js --url "${url}" --mappe "${mappe}" --crop ${crop}`);
      break;
    }

    case '7': {
      kor('node manglende-byer.js');
      break;
    }

    case '8':
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
