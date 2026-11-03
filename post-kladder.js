// Opretter kladder i Billboard fra en JSON-fil (enabled: false – intet bliver synligt).
// Kør i mappen med billboard-api.js og .env (BILLBOARD_API_KEY, SITE_URL):
//   node --env-file=.env post-kladder.js kladder-massage.json

import { readFileSync } from 'fs';
import { opretArtikelViaApi } from './billboard-api.js';

if (!process.env.BILLBOARD_API_KEY) {
  console.error('BILLBOARD_API_KEY mangler i .env');
  process.exit(1);
}

const kladder = JSON.parse(readFileSync(process.argv[2], 'utf8'));
for (const k of kladder) {
  const link = await opretArtikelViaApi({
    artikel: { title: k.title, meta: k.metaDescription, intro: k.intro, body: k.body, imageText: k.imageText },
    emne: k.topicId,
    sprog: 'da',
    blog: false,
  });
  console.log('Kladde oprettet:', link);
}
