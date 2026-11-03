// escort5-auto/billboard-api.js
// Opretter artikler via Billboards API (#274) med en admin-API-nøgle i BILLBOARD_API_KEY.
// Erstatter login og formularudfyldning i admin-siden med et enkelt kald.

import fs from 'fs';
import path from 'path';
import { assertRequiredEnv } from './security.js';

function lavSlug(tekst) {
  return tekst
    .replace(/[æÆ]/g, 'ae').replace(/[øØ]/g, 'oe').replace(/[åÅ]/g, 'aa')
    .replace(/[äÄ]/g, 'ae').replace(/[öÖ]/g, 'oe')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function apiUrl(sti) {
  const site = process.env.SITE_URL || 'https://escort5.dk/';
  return new URL('/api/ext/v1/topics' + sti, site);
}

function apiHeaders() {
  return { Authorization: 'Bearer ' + process.env.BILLBOARD_API_KEY };
}

async function fejlFra(res) {
  const tekst = await res.text().catch(() => '');
  return new Error('Billboard API HTTP ' + res.status + ' ' + res.statusText + (tekst ? ' - ' + tekst.slice(0, 300) : ''));
}

// Finder et ledigt adresse-navn (topicId) i kategorien: emne, emne-2, emne-3 …
async function ledigTopicId(kategori, baseSlug) {
  const res = await fetch(apiUrl('?category=' + kategori), { headers: apiHeaders() });
  if (!res.ok) throw await fejlFra(res);
  const eksisterende = new Set((await res.json()).map(t => t.topicId));

  let slug = baseSlug;
  let nr = 2;
  while (eksisterende.has(slug)) {
    slug = baseSlug + '-' + nr;
    nr++;
  }
  return slug;
}

/**
 * Opretter en artikel (eller blog) som ikke-publiceret kladde.
 * artikel: { imageText, title, intro, body, meta } fra Claude
 * sprog: 'da' eller 'sv' (sitets sprog)
 * billedeSti: valgfri sti til et billede der sendes med kaldet
 * Returnerer adressen (link) på den oprettede side.
 */
export async function opretArtikelViaApi({ artikel, emne, sprog, blog, billedeSti }) {
  assertRequiredEnv(['BILLBOARD_API_KEY']);

  const kategori = blog ? 'Blog' : 'Article';
  const topicId = await ledigTopicId(kategori, lavSlug(emne));

  const topic = {
    category: kategori,
    topicId,
    texts: {
      [sprog]: {
        title: artikel.title,
        metaDescription: artikel.meta,
        intro: artikel.intro,
        body: artikel.body,
        imageText: artikel.imageText,
      },
    },
  };

  const form = new FormData();
  form.append('topic', JSON.stringify(topic));
  if (billedeSti) {
    const bytes = fs.readFileSync(billedeSti);
    const billedType = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }[path.extname(billedeSti).toLowerCase()];
    form.append('picture', new Blob([bytes], { type: billedType }), path.basename(billedeSti));
  }

  const res = await fetch(apiUrl(''), { method: 'POST', headers: apiHeaders(), body: form });
  if (!res.ok) throw await fejlFra(res);
  const oprettet = await res.json();
  return oprettet.link;
}
