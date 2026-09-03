/**
 * Visual check harness. Renders the built site across the breakpoints, color
 * schemes and accessibility settings the design brief asks to be verified.
 *
 * Note on `fullPage`: Chrome resizes the viewport to capture it, which fires
 * the simulations' ResizeObserver and clears their trail buffers, so a
 * full-page shot of a running canvas comes out empty. Figure shots therefore
 * scroll to the element at a fixed viewport instead.
 *
 * Run against a running `astro preview`:
 *   node scripts/shots.mjs [outDir] [baseUrl]
 */

import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const OUT = process.argv[2] ?? path.resolve('shots');
const BASE = process.argv[3] ?? 'http://localhost:4321';
/** Override with CHROME_PATH when the browser lives somewhere else. */
const CHROME =
  process.env.CHROME_PATH ??
  (process.platform === 'win32'
    ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
    : process.platform === 'darwin'
      ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      : '/usr/bin/google-chrome');

mkdirSync(OUT, { recursive: true });

const CASES = [
  { name: '01-home-1440-light', url: '/', w: 1440, h: 900, scheme: 'light' },
  { name: '02-home-1440-dark', url: '/', w: 1440, h: 900, scheme: 'dark' },
  { name: '03-home-768-light', url: '/', w: 768, h: 1024, scheme: 'light' },
  { name: '04-home-320-light', url: '/', w: 320, h: 640, scheme: 'light' },
  { name: '05-home-1440-reduced', url: '/', w: 1440, h: 900, scheme: 'light', reduced: true },
  { name: '06-home-1440-nojs', url: '/', w: 1440, h: 900, scheme: 'light', nojs: true },

  // Figures, captured in place at a fixed viewport.
  { name: '07-fig2-sampler-light', url: '/', w: 1440, h: 900, scheme: 'light', to: '[data-sim="diffusion"]', settle: 5000 },
  { name: '08-fig2-sampler-dark', url: '/', w: 1440, h: 900, scheme: 'dark', to: '[data-sim="diffusion"]', settle: 5000 },
  { name: '09-fig2-sampler-320', url: '/', w: 320, h: 640, scheme: 'light', to: '[data-sim="diffusion"]', settle: 5000 },
  { name: '10-fig3-diffusivity-light', url: '/research', w: 1440, h: 900, scheme: 'light', to: '[data-sim="diffusivity"]', settle: 24000 },
  { name: '11-fig3-diffusivity-dark', url: '/research', w: 1440, h: 900, scheme: 'dark', to: '[data-sim="diffusivity"]', settle: 24000 },
  { name: '12-fig3-diffusivity-320', url: '/research', w: 320, h: 640, scheme: 'light', to: '[data-sim="diffusivity"]', settle: 24000 },
  { name: '12b-fig4-raretail-light', url: '/research', w: 1440, h: 900, scheme: 'light', to: '[data-sim="raretail"]', settle: 14000 },
  { name: '12c-fig4-raretail-dark', url: '/research', w: 1440, h: 900, scheme: 'dark', to: '[data-sim="raretail"]', settle: 14000 },
  { name: '12d-fig4-raretail-nojs', url: '/research', w: 1440, h: 900, scheme: 'light', nojs: true, to: '[data-sim="raretail"]' },
  { name: '13-fig2-reduced', url: '/', w: 1440, h: 900, scheme: 'light', reduced: true, to: '[data-sim="diffusion"]' },
  { name: '14-fig3-nojs', url: '/research', w: 1440, h: 900, scheme: 'light', nojs: true, to: '[data-sim="diffusivity"]' },

  // Text pages, where a full-page capture is safe.
  { name: '15-home-full-light', url: '/', w: 1440, h: 900, scheme: 'light', full: true },
  { name: '16-home-full-dark', url: '/', w: 1440, h: 900, scheme: 'dark', full: true },
  { name: '17-research-full-light', url: '/research', w: 1440, h: 900, scheme: 'light', full: true },
  { name: '22-research-768-dark', url: '/research', w: 768, h: 1024, scheme: 'dark', full: true },
  { name: '23-home-320-full', url: '/', w: 320, h: 640, scheme: 'light', full: true },
  { name: '24-cv', url: '/cv', w: 1440, h: 900, scheme: 'light' },
  { name: '25-404', url: '/404', w: 1440, h: 900, scheme: 'light' },
];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'shell',
  args: ['--force-device-scale-factor=1', '--hide-scrollbars'],
});

const problems = [];

for (const c of CASES) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => problems.push(`${c.name}: pageerror ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`${c.name}: console ${m.text()}`);
  });

  await page.setViewport({ width: c.w, height: c.h, deviceScaleFactor: 2 });
  if (c.nojs) await page.setJavaScriptEnabled(false);
  await page.emulateMediaFeatures([
    { name: 'prefers-color-scheme', value: c.scheme },
    { name: 'prefers-reduced-motion', value: c.reduced ? 'reduce' : 'no-preference' },
  ]);
  await page.goto(BASE + c.url, { waitUntil: 'networkidle0', timeout: 60000 });

  if (c.to) {
    await page.evaluate((sel) => {
      document.querySelector(sel)?.scrollIntoView({ block: 'center' });
    }, c.to);
  }
  await new Promise((r) => setTimeout(r, c.settle ?? 2500));

  await page.screenshot({ path: path.join(OUT, `${c.name}.png`), fullPage: !!c.full });
  console.log(c.name);
  await page.close();
}

await browser.close();

if (problems.length) {
  console.log('\nPAGE ERRORS');
  for (const p of problems) console.log('  ' + p);
} else {
  console.log('\nno console errors or page errors');
}
console.log('wrote to', OUT);
