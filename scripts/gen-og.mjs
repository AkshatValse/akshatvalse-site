/**
 * Social card generator.
 *
 * Writes public/og.png, the image that link previews show on LinkedIn, Slack,
 * Bluesky and anywhere else the site gets shared. That is how an academic site
 * actually circulates, so the card is worth getting right.
 *
 * It is rendered by headless Chrome rather than by sharp's SVG path, because
 * the card has to be set in the site's own faces and sharp renders SVG text
 * through fontconfig, which sees whatever fonts the build machine happens to
 * have. Chrome renders the real woff2, embedded here as a data URI so nothing
 * has to be fetched.
 *
 * The output is committed rather than generated during `npm run build`, so a
 * Linux build box never has to reproduce it. Re-run this by hand after
 * changing the name, the tagline, or the hero.
 *
 *   node scripts/gen-og.mjs      (requires a prior `astro build`)
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');

/** Override with CHROME_PATH when the browser lives somewhere else. */
const CHROME =
  process.env.CHROME_PATH ??
  (process.platform === 'win32'
    ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
    : process.platform === 'darwin'
      ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      : '/usr/bin/google-chrome');

if (!existsSync(path.join(DIST, 'index.html'))) {
  console.error('dist/index.html is missing. Run `astro build` first.');
  process.exit(1);
}

const html = readFileSync(path.join(DIST, 'index.html'), 'utf8');

/**
 * Pull one family's woff2 out of the built stylesheet. Astro emits a hashed
 * family name per family and a @font-face per file, so match on the CSS
 * variable's value and take the first source declared for it.
 */
function fontFor(cssVar) {
  const varMatch = html.match(new RegExp(`${cssVar}:\\s*([^;,]+)`));
  if (!varMatch) throw new Error(`no ${cssVar} in the built CSS`);
  const family = varMatch[1].trim().replace(/^["']|["']$/g, '');
  const faceRe = new RegExp(
    `@font-face\\{font-family:"?${family.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"?;` +
      `src:url\\("([^"]+)"\\)`,
    'i'
  );
  const face = html.match(faceRe);
  if (!face) throw new Error(`no @font-face for ${family}`);
  const file = path.join(DIST, face[1].replace(/^\//, ''));
  return { family, b64: readFileSync(file).toString('base64') };
}

const display = fontFor('--font-display');
const mono = fontFor('--font-mono');

/** Tokens, read from the stylesheet so the card cannot drift from the site. */
const css = readFileSync(path.join(ROOT, 'src', 'styles', 'global.css'), 'utf8');
const light = css.slice(0, css.indexOf('@media'));
const token = (n) => light.match(new RegExp(`--${n}:\\s*([^;]+);`))[1].trim();

const hero = readFileSync(path.join(ROOT, 'public', 'poster', 'hero-light-1440.webp'))
  .toString('base64');

const W = 1200, H = 630;

const page = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:D;src:url(data:font/woff2;base64,${display.b64}) format('woff2');font-weight:400 700}
@font-face{font-family:M;src:url(data:font/woff2;base64,${mono.b64}) format('woff2')}
*{margin:0;padding:0;box-sizing:border-box}
body{width:${W}px;height:${H}px;background:${token('ground')};overflow:hidden}
.field{height:372px;width:100%;background-image:url(data:image/webp;base64,${hero});
  background-size:cover;background-position:center;border-bottom:1px solid ${token('rule')}}
.band{height:258px;padding:38px 56px 0;display:flex;flex-direction:column;justify-content:flex-start}
h1{font-family:D;font-weight:600;font-variation-settings:'wdth' 120;font-size:70px;
  line-height:1;letter-spacing:-.02em;color:${token('ink')}}
p{font-family:M;font-size:22px;line-height:1.5;color:${token('ink-2')};margin-top:20px;letter-spacing:.01em}
b{color:${token('ink')};font-weight:500}
</style></head><body>
<div class="field"></div>
<div class="band">
  <h1>Akshat Sachin Valse</h1>
  <p>stochastic foundations of machine learning &middot; Iowa State University</p>
  <p><b>akshatvalse.com</b></p>
</div>
</body></html>`;

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'shell' });
const p = await browser.newPage();
await p.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
await p.setContent(page, { waitUntil: 'load' });
await p.evaluate(() => document.fonts.ready);
const raw = await p.screenshot();
await browser.close();

// Quantized PNG rather than JPEG: the card is mostly flat ground with type on
// it, and JPEG rings around the letterforms at any quality worth the bytes.
const out = path.join(ROOT, 'public', 'og.png');
await sharp(raw).png({ quality: 80, compressionLevel: 9, palette: true }).toFile(out);

const bytes = readFileSync(out).length;
console.log(`og.png  ${W}x${H}  ${(bytes / 1024).toFixed(1)} KB`);
console.log(`fonts   ${display.family}, ${mono.family}`);
