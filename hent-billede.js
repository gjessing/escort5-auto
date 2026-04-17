// hent-billede.js
// Henter full-size billeder via Playwright - omgaar hotlink protection
// Brug: node hent-billede.js --url "https://example.com" --mappe "escort"

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
process.emitWarning = (warning, ...args) => { if (String(warning).includes('NODE_TLS')) return; require('events').EventEmitter.prototype.emit.call(process, 'warning', warning, ...args); };
import 'dotenv/config';
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import minimist from 'minimist';
import * as readline from 'readline';

const args = minimist(process.argv.slice(2));
const URL_ARG = args.url   || args.u || null;
const MAPPE   = args.mappe || args.m || 'generelle';

if (!URL_ARG) {
  console.error('\nMangler URL!');
  console.error('Brug: node hent-billede.js --url "https://example.com" --mappe "escort"\n');
  process.exit(1);
}

function sporg(sporgsmaal) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(sporgsmaal, ans => { rl.close(); resolve(ans.trim()); }));
}

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 100 });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('\nIndlaeser side: ' + URL_ARG);
  await page.goto(URL_ARG, { waitUntil: 'networkidle' });

  // Scroll ned for at loade lazy-load billeder
  console.log('  Scroller for at loade alle billeder...');
  await page.evaluate(async () => {
    await new Promise(resolve => {
      let total = document.body.scrollHeight;
      let current = 0;
      const step = 600;
      const timer = setInterval(() => {
        window.scrollBy(0, step);
        current += step;
        if (current >= total) {
          total = document.body.scrollHeight;
          if (current >= total) {
            clearInterval(timer);
            window.scrollTo(0, 0);
            resolve();
          }
        }
      }, 200);
    });
  });
  await page.waitForTimeout(1500);

  // Find kun billeder fra hoved-galleriet - spring relaterede sektioner over
  const billeder = await page.evaluate(() => {
    const resultater = [];
    const billedExtensions = /\.(jpg|jpeg|png|webp|gif)(\?.*)?$/i;

    // Klasser der indikerer relaterede/anbefalede sektioner
    const stopKlasser = ['related', 'recommend', 'similar', 'more-gall', 'suggestion', 'also-like', 'sponsor'];
    const stopIds = ['main2', 'related', 'recommended', 'similar'];

    function erIRelateret(el) {
      let node = el;
      while (node && node !== document.body) {
        const cls = (node.className || '').toLowerCase();
        const id  = (node.id || '').toLowerCase();
        if (stopKlasser.some(k => cls.includes(k) || id.includes(k))) return true;
        if (stopIds.some(k => id === k)) return true;
        node = node.parentElement;
      }
      return false;
    }

    document.querySelectorAll('img').forEach(img => {
      if (!img.src || !img.src.startsWith('http')) return;
      if (img.naturalWidth < 200 || img.naturalHeight < 200) return;
      if (img.src.includes('logo') || img.src.includes('icon') || img.src.includes('banner') || img.src.includes('sprite')) return;
      if (erIRelateret(img)) return;

      const link = img.closest('a');
      const fullSrc = (link && link.href && billedExtensions.test(link.href))
        ? link.href
        : img.src;

      resultater.push({
        fullSrc,
        thumbSrc: img.src,
        alt: img.alt || '',
        width: img.naturalWidth,
        height: img.naturalHeight,
        erFull: fullSrc !== img.src
      });
    });

    return resultater;
  });

  if (billeder.length === 0) {
    console.log('Ingen billeder fundet (min. 200x200px).');
    await browser.close();
    process.exit(0);
  }

  console.log('\nFandt ' + billeder.length + ' billeder:\n');
  billeder.forEach((b, i) => {
    const dim = ' (' + b.width + 'x' + b.height + ')';
    const alt = b.alt ? ' - "' + b.alt.substring(0, 35) + '"' : '';
    const full = b.erFull ? ' [FULL SIZE tilgaengelig]' : '';
    console.log((i + 1) + '. ' + b.thumbSrc.substring(0, 70) + dim + alt + full);
  });

  const svar = await sporg('\nHvilket billede? (nummer eller "alle"): ');

  let valgte = [];
  if (svar.toLowerCase() === 'alle') {
    valgte = billeder;
  } else {
    const nr = parseInt(svar);
    if (isNaN(nr) || nr < 1 || nr > billeder.length) {
      console.error('Ugyldigt nummer.');
      await browser.close();
      process.exit(1);
    }
    valgte = [billeder[nr - 1]];
  }

  // Opret mappe
  const billedeMappe = join(process.cwd(), 'billeder', MAPPE);
  if (!existsSync(billedeMappe)) {
    mkdirSync(billedeMappe, { recursive: true });
  }

  for (const b of valgte) {
    console.log('\nHenter: ' + b.fullSrc.substring(0, 70) + '...');

    try {
      // Naviger direkte til billedet og gem via response
      const imgPage = await context.newPage();
      const response = await imgPage.goto(b.fullSrc, { waitUntil: 'load' });

      if (response && response.ok()) {
        const rawBuffer = await response.body();

        // Crop 3% af bunden med sharp
        const { default: sharp } = await import('sharp');
        const metadata = await sharp(rawBuffer).metadata();
        const cropPct = args.crop || 3;
        const nyHojde = Math.round(metadata.height * (1 - cropPct / 100));
        console.log('  Afskærer ' + cropPct + '% af bunden');
        const buffer = await sharp(rawBuffer)
          .extract({ left: 0, top: 0, width: metadata.width, height: nyHojde })
          .jpeg({ quality: 92 })
          .toBuffer();

        // Tael eksisterende filer for at faa naeste nummer
        const { readdirSync } = await import('fs');
        const eksisterende = existsSync(billedeMappe) ? readdirSync(billedeMappe).filter(f => f.endsWith('.jpg')).length : 0;
        const nr = String(eksisterende + 1).padStart(3, '0');
        const seoNavn = MAPPE.toLowerCase()
          .replace(/ae/g,'ae').replace(/oe/g,'oe').replace(/aa/g,'aa')
          .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const filnavn = seoNavn + '-' + nr + '.jpg';
        const filsti = join(billedeMappe, filnavn);
        writeFileSync(filsti, buffer);
        console.log('  OK: Gemt som billeder/' + MAPPE + '/' + filnavn);
        console.log('  Storrelse: ' + Math.round(buffer.length / 1024) + ' KB (' + metadata.width + 'x' + nyHojde + ' px)');
      } else {
        console.log('  Advarsel: Kunne ikke hente billedet - prover screenshot...');
        const { readdirSync: rds } = await import('fs');
        const eks2 = existsSync(billedeMappe) ? rds(billedeMappe).filter(f => f.endsWith('.jpg') || f.endsWith('.png')).length : 0;
        const nr2 = String(eks2 + 1).padStart(3, '0');
        const seoNavn2 = MAPPE.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const filnavn = seoNavn2 + '-' + nr2 + '.png';
        const filsti = join(billedeMappe, filnavn);
        await imgPage.screenshot({ path: filsti });
        console.log('  OK: Screenshot gemt som billeder/' + MAPPE + '/' + filnavn);
      }

      await imgPage.close();
    } catch(e) {
      console.log('  Fejl ved hentning: ' + e.message);
    }
  }

  await browser.close();
  console.log('\nFaerdig! Billederne er klar i billeder/' + MAPPE + '/');
})().catch(err => {
  console.error('\nFejl: ' + err.message);
  process.exit(1);
});
