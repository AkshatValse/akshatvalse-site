/**
 * Per-note social cards.
 *
 * A shared preview image wastes the strongest asset the site has. Each note
 * gets a card carrying its own figure above its own title, so a link dropped
 * into Slack or Bluesky shows what the note is actually about.
 *
 * Same pipeline as scripts/gen-og.mjs: headless Chrome so the card is set in
 * the site's real faces, output committed so a Linux build box never has to
 * reproduce it. Re-run after adding a note or changing a title.
 *
 *   node scripts/gen-og-notes.mjs      (requires a prior `astro build`)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const NOTES = path.join(ROOT, 'src', 'content', 'notes');
const OUT_DIR = path.join(ROOT, 'public', 'og');

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
mkdirSync(OUT_DIR, { recursive: true });

/**
 * Which figure belongs on each note's card. A note about a quantity should
 * show the figure that measures it.
 */
const FIGURE = {
  'effective-diffusivity-cosine-potential': {
    kind: 'svg',
    file: path.join(ROOT, 'src', 'generated', 'diffusivity-poster.svg'),
  },
  'grading-a-diffusion-model': {
    kind: 'raster',
    file: path.join(ROOT, 'public', 'poster', 'diffusion-light.webp'),
    mime: 'image/webp',
  },
  'what-the-metropolis-correction-buys': {
    kind: 'raster',
    file: path.join(ROOT, 'public', 'poster', 'hero-light-1440.webp'),
    mime: 'image/webp',
  },
};

const html = readFileSync(path.join(DIST, 'index.html'), 'utf8');

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
  return readFileSync(path.join(DIST, face[1].replace(/^\//, ''))).toString('base64');
}

const display = fontFor('--font-display');
const mono = fontFor('--font-mono');
const body = fontFor('--font-body');

const css = readFileSync(path.join(ROOT, 'src', 'styles', 'global.css'), 'utf8');
const light = css.slice(0, css.indexOf('@media'));
const token = (n) => light.match(new RegExp(`--${n}:\\s*([^;]+);`))[1].trim();

/** Minimal frontmatter read; the schema is validated by Astro at build time. */
function frontmatter(src) {
  const m = src.match(/^---\n([\s\S]*?)\n---/);
  const out = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

const W = 1200, H = 630;
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'shell' });
const results = [];

for (const file of readdirSync(NOTES).filter((f) => /\.mdx?$/.test(f))) {
  const slug = file.replace(/\.mdx?$/, '');
  const fm = frontmatter(readFileSync(path.join(NOTES, file), 'utf8'));
  const fig = FIGURE[slug];
  if (!fig) {
    console.log(`  no figure mapped for ${slug}; add one to FIGURE`);
    continue;
  }

  const figMarkup =
    fig.kind === 'svg'
      ? `<div class="fig svg">${readFileSync(fig.file, 'utf8')}</div>`
      : `<div class="fig raster" style="background-image:url(data:${fig.mime};base64,${readFileSync(fig.file).toString('base64')})"></div>`;

  const page = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:D;src:url(data:font/woff2;base64,${display}) format('woff2');font-weight:400 700}
@font-face{font-family:M;src:url(data:font/woff2;base64,${mono}) format('woff2')}
@font-face{font-family:B;src:url(data:font/woff2;base64,${body}) format('woff2');font-weight:400 700}
*{margin:0;padding:0;box-sizing:border-box}
body{width:${W}px;height:${H}px;background:${token('ground')};overflow:hidden;
  display:flex;flex-direction:column}
.fig{height:330px;width:100%;border-bottom:1px solid ${token('rule')};
  background:${token('sim-bg')};overflow:hidden;flex:none}
.fig.raster{background-size:cover;background-position:center}
.fig.svg{display:flex;align-items:center;justify-content:center;padding:10px 40px}
.fig.svg svg{width:100%;height:auto;max-height:310px}
.band{flex:1;padding:32px 56px 0;display:flex;flex-direction:column}
.kicker{font-family:M;font-size:17px;letter-spacing:.09em;text-transform:uppercase;
  color:${token('ink-2')}}
h1{font-family:B;font-weight:600;font-size:40px;line-height:1.18;color:${token('ink')};
  margin-top:14px;letter-spacing:-.005em}
.foot{font-family:M;font-size:19px;color:${token('ink-2')};margin-top:auto;padding-bottom:30px}
b{color:${token('ink')};font-weight:500}
</style></head><body>
${figMarkup}
<div class="band">
  <div class="kicker">Note</div>
  <h1>${fm.title.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</h1>
  <div class="foot"><b>akshatvalse.com</b>/notes</div>
</div>
</body></html>`;

  const p = await browser.newPage();
  await p.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  await p.setContent(page, { waitUntil: 'load' });
  await p.evaluate(() => document.fonts.ready);
  const raw = await p.screenshot();
  await p.close();

  const out = path.join(OUT_DIR, `${slug}.png`);
  await sharp(raw).png({ quality: 80, compressionLevel: 9, palette: true }).toFile(out);
  const kb = readFileSync(out).length / 1024;
  results.push({ slug, kb });
  console.log(`  og/${slug}.png   ${kb.toFixed(1)} KB`);
}

await browser.close();
console.log(`\n${results.length} note cards written to public/og/`);
