// Opretter kladder i Billboard fra en JSON-fil (enabled: false – intet bliver synligt).
// Kør i mappen med billboard-api.js og .env (API_KEY, SITE_URL):
//   node --env-file=.env post-kladder.js kladder-massage.json

import { readFileSync } from 'fs';
import { opretArtikelViaApi } from './billboard-api.js';

const { API_KEY, SITE_URL = 'https://escort5.dk' } = process.env;
if (!API_KEY) {
  console.error('API_KEY mangler i .env');
  process.exit(1);
}

const kladder = JSON.parse(readFileSync(process.argv[2], 'utf8'));
for (const k of kladder) {
  const svar = await opretArtikelViaApi({
    siteUrl: SITE_URL,
    apiKey: API_KEY,
    artikel: { title: k.title, meta: k.metaDescription, intro: k.intro, body: k.body, imageText: k.imageText },
    kategori: 'Article',
    sprog: 'da',
    topicBase: k.topicId,
  });
  console.log('Kladde oprettet:', svar.topicId);
}
