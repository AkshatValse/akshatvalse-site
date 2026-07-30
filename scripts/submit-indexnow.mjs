/**
 * Submit the sitemap's URLs to IndexNow.
 *
 * IndexNow is a push protocol: one request tells Bing, Yandex, Seznam and Naver
 * that a set of URLs changed, instead of waiting to be crawled. DuckDuckGo and
 * Ecosia read Bing's index, so this covers everything except Google, which has
 * no equivalent and has to be reached through Search Console.
 *
 * Ownership is proved by hosting the key at /<key>.txt, which public/ does.
 *
 *   node scripts/submit-indexnow.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KEY = '4dd6641ccbc9494eebd2f636139bc2a7';
const HOST = process.env.SITE_HOST ?? 'akshatvalse.com';

const sitemap = readFileSync(path.join(ROOT, 'dist', 'sitemap-0.xml'), 'utf8');
const urlList = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
if (!urlList.length) {
  console.error('no URLs in dist/sitemap-0.xml; run `astro build` first');
  process.exit(1);
}

const body = {
  host: HOST,
  key: KEY,
  keyLocation: `https://${HOST}/${KEY}.txt`,
  urlList,
};

const res = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify(body),
});

console.log(`IndexNow → ${res.status} ${res.statusText}`);
for (const u of urlList) console.log('  ' + u);
console.log('\n200 or 202 means accepted. Indexing still takes days; this only');
console.log('removes the wait to be discovered.');
