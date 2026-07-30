/**
 * Lighthouse over the built site, mobile emulation and throttling (the default
 * preset), against a running `astro preview`.
 *
 *   node scripts/lighthouse.mjs [baseUrl] [paths...]
 */

import puppeteer from 'puppeteer-core';
import lighthouse from 'lighthouse';

/** Override with CHROME_PATH when the browser lives somewhere else. */
const CHROME =
  process.env.CHROME_PATH ??
  (process.platform === 'win32'
    ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
    : process.platform === 'darwin'
      ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      : '/usr/bin/google-chrome');
const BASE = process.argv[2] ?? 'http://localhost:4321';
const PATHS = process.argv.slice(3).length
  ? process.argv.slice(3)
  : ['/', '/research', '/notes/grading-a-diffusion-model'];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'shell',
  args: ['--remote-debugging-port=9222', '--no-first-run'],
});
const port = Number(new URL(browser.wsEndpoint()).port);

const pct = (c) => (c == null ? '  — ' : String(Math.round(c.score * 100)).padStart(4));

console.log('Lighthouse — mobile preset (default throttling)');
console.log('='.repeat(78));
console.log('path                                    perf   a11y   b.p.   seo   LCP     CLS    TBT');

for (const p of PATHS) {
  const res = await lighthouse(BASE + p, { port, output: 'json', logLevel: 'error' });
  const c = res.lhr.categories;
  const a = res.lhr.audits;
  console.log(
    p.padEnd(38) +
      pct(c.performance) + '  ' + pct(c.accessibility) + '  ' +
      pct(c['best-practices']) + '  ' + pct(c.seo) + '   ' +
      String(a['largest-contentful-paint'].displayValue).padEnd(8) +
      String(a['cumulative-layout-shift'].displayValue).padEnd(7) +
      String(a['total-blocking-time'].displayValue)
  );

  const failed = Object.values(a).filter(
    (x) => x.score !== null && x.score < 1 && x.scoreDisplayMode === 'binary'
  );
  for (const f of failed) console.log(`      ✗ ${f.id}: ${f.title}`);

  const perfOpps = Object.values(a).filter(
    (x) => x.details?.type === 'opportunity' && x.numericValue > 100
  );
  for (const o of perfOpps) console.log(`      · ${o.id}: ${o.displayValue}`);
}

await browser.close();
