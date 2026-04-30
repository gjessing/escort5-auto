// hent-billede.js
// Henter full-size billeder via Playwright - omgaar hotlink protection
// Brug: node hent-billede.js --url "https://example.com" --mappe "escort"

import 'dotenv/config';
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import minimist from 'minimist';
import * as readline from 'readline';
import { parsePercent, sanitizeLabel, validateHttpUrl } from './security.js';

const args = minimist(process.argv.slice(2));
const URL_ARG = validateHttpUrl(args.url || args.u || '', 'url');
const MAPPE   = sanitizeLabel(args.mappe || args.m || 'generelle', 'mappe');
const CROP_PCT = parsePercent(args.crop, 'crop', 3);

function sporg(sporgsmaal) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(sporgsmaal, ans => { rl.close(); resolve(ans.trim()); }));
}

(async () => {
  const erLinuxServer = process.platform === 'linux' && !process.env.DISPLAY;
  const browser = await chromium.launch({ headless: erLinuxServer, slowMo: 100 });
  const context = await browser.newContext();
  const page    = await context.newPage();

  console.log('\nIndlaeser side: ' + URL_ARG);
  await page.goto(URL_ARG, { waitUntil: 'networkidle' });

  // Accepter aldersbegrænsning hvis den vises (pornpics.com og lignende)
  const ageSelectors = [
    'button[class*="enter"]', 'button[class*="age"]', 'button[class*="adult"]',
    'a[class*="enter"]', 'a[class*="age"]', '.age-gate button', '.age-verify button',
    'button:has-text("Enter")', 'button:has-text("I am")', 'button:has-text("Yes")',
    '#age-gate button', '.enter-button', '[data-age] button'
  ];
  for (const sel of ageSelectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.count() > 0) {
        await el.click();
        await page.waitForTimeout(1000);
        console.log('  OK: Aldersbegrænsning accepteret');
        break;
      }
    } catch(_) {}
  }

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

  // Find billeder - spring relaterede sektioner over
  const billeder = await page.evaluate(() => {
    const resultater = [];
    const billedExtensions = /\.(jpg|jpeg|png|webp|gif)(\?.*)?$/i;
    const stopKlasser = ['related', 'recommend', 'similar', 'more-gall', 'suggestion', 'also-like', 'sponsor'];
    const stopIds     = ['main2', 'related', 'recommended', 'similar'];

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

      const link    = img.closest('a');
      const fullSrc = (link && link.href && billedExtensions.test(link.href)) ? link.href : img.src;

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
    const dim  = ' (' + b.width + 'x' + b.height + ')';
    const alt  = b.alt ? ' - "' + b.alt.substring(0, 35) + '"' : '';
    const full = b.erFull ? ' [FULL SIZE]' : '';
    console.log((i + 1) + '. ' + b.thumbSrc.substring(0, 70) + dim + alt + full);
  });

  // Opret mappe
  const billedeMappe = join(process.cwd(), 'billeder', MAPPE);
  if (!existsSync(billedeMappe)) {
    mkdirSync(billedeMappe, { recursive: true });
  }

  console.log('\nHenter alle ' + billeder.length + ' billeder...\n');

  for (const valgt of billeder) {
    console.log('Henter: ' + valgt.fullSrc.substring(0, 70) + '...');

    try {
      const imgPage  = await context.newPage();
      const response = await imgPage.goto(valgt.fullSrc, { waitUntil: 'load' });

    if (response && response.ok()) {
      const rawBuffer = await response.body();

      // Crop bunden
      const { default: sharp } = await import('sharp');
      const metadata = await sharp(rawBuffer).metadata();
      const nyHojde  = Math.round(metadata.height * (1 - CROP_PCT / 100));
      console.log('  Afskærer ' + CROP_PCT + '% af bunden (' + metadata.height + ' → ' + nyHojde + 'px)');

      const buffer = await sharp(rawBuffer)
        .extract({ left: 0, top: 0, width: metadata.width, height: nyHojde })
        .jpeg({ quality: 92 })
        .toBuffer();

      // SEO-venligt filnavn med nummer
      const eksisterende = readdirSync(billedeMappe).filter(f => f.endsWith('.jpg')).length;
      const numStr  = String(eksisterende + 1).padStart(3, '0');
      const seoNavn = MAPPE.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const filnavn = seoNavn + '-' + numStr + '.jpg';
      const filsti  = join(billedeMappe, filnavn);

      writeFileSync(filsti, buffer);
      console.log('  OK: Gemt som billeder/' + MAPPE + '/' + filnavn);
      console.log('  Storrelse: ' + Math.round(buffer.length / 1024) + ' KB (' + metadata.width + 'x' + nyHojde + ' px)');
    } else {
      // Fallback: screenshot
      const eksisterende = readdirSync(billedeMappe).filter(f => f.endsWith('.png') || f.endsWith('.jpg')).length;
      const numStr  = String(eksisterende + 1).padStart(3, '0');
      const seoNavn = MAPPE.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const filnavn = seoNavn + '-' + numStr + '.png';
      const filsti  = join(billedeMappe, filnavn);
      await imgPage.screenshot({ path: filsti });
      console.log('  OK: Screenshot gemt som billeder/' + MAPPE + '/' + filnavn);
    }

      await imgPage.close();
    } catch (e) {
      console.log('  Fejl ved hentning: ' + e.message);
    }
  } // slut for loop

  await browser.close();
  console.log('\nFaerdig! Billedet er klar i billeder/' + MAPPE + '/');

})().catch(err => {
  console.error('\nFejl: ' + err.message);
  process.exit(1);
});