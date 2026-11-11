/**
 * Social cards.
 *
 * Writes the images that link previews show on X, LinkedIn, Slack, Bluesky and
 * anywhere else a page of the site is shared:
 *
 *   public/og/<slug>.png   one per research project, laid out like that
 *                          project's tile on the Research page: the stage
 *                          label, the title and subtitle on white, and the
 *                          project's cover artwork inset in its themed frame
 *   public/og/site.png     every other page: the name, the tagline and the
 *                          portrait in the same frame
 *
 * Everything comes from the same data as the site (src/data/projects.ts,
 * themes.ts, site.ts, the cover-art SVGs and the portrait), so a card cannot
 * drift from the page it advertises. Text is Poppins, as on the site, loaded
 * from Google Fonts by headless Chrome, so this needs a network connection.
 *
 * The output is committed rather than generated during `npm run build`, so a
 * Linux build box never has to reproduce it. Re-run after changing a project's
 * title, subtitle, stage, theme or artwork, the tagline, or the portrait:
 *
 *   node scripts/gen-og.mjs      (needs Chrome; set CHROME_PATH if it is elsewhere)
 *
 * Layout rules: the copy stays in the upper part of the left column because X
 * draws the page title over the bottom left of a large-image card.
 */
import { register } from 'node:module';
import { readFileSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';

// src/data/*.ts is TypeScript with extensionless imports; let Node load it.
register(
  'data:text/javascript,' + encodeURIComponent(
    'export async function resolve(s, c, n) { try { return await n(s, c); } catch (e) {' +
    ' if (e.code === "ERR_MODULE_NOT_FOUND" && c.parentURL?.endsWith(".ts") && s.startsWith(".")) return n(s + ".ts", c);' +
    ' throw e; } }'),
  import.meta.url,
);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { PROJECTS } = await import(pathToFileURL(path.join(ROOT, 'src/data/projects.ts')).href);
const { PROFILE } = await import(pathToFileURL(path.join(ROOT, 'src/data/site.ts')).href);

/** Override with CHROME_PATH when the browser lives somewhere else. */
const CHROME =
  process.env.CHROME_PATH ??
  (process.platform === 'win32'
    ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
    : process.platform === 'darwin'
      ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      : '/usr/bin/google-chrome');

/** Tokens, read from the stylesheet so the card cannot drift from the site. */
const css = readFileSync(path.join(ROOT, 'src', 'styles', 'global.css'), 'utf8');
const token = (n) => css.match(new RegExp(`--${n}:\\s*([^;]+);`))[1].trim();
const INK = token('ink');
const INK2 = token('ink-2');

const W = 1200, H = 630;
const FRAME_W = 504; // 4:5, as the frames on the Research page
const dataUri = (file, mime) => `data:${mime};base64,${readFileSync(path.join(ROOT, file)).toString('base64')}`;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const page = ({ badge, title, sub, by, frameStyle, inner }) => `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;700&display=block" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{width:${W}px;height:${H}px;background:#fff;overflow:hidden;font-family:'Poppins',sans-serif;color:${INK}}
.left{position:absolute;left:64px;top:62px;width:${W - FRAME_W - 64 - 56}px}
.badge{font-size:22px;font-weight:500;letter-spacing:.14em;text-transform:uppercase;color:${INK2}}
h1{font-size:68px;font-weight:700;line-height:1.06;letter-spacing:-.015em;margin-top:18px}
.sub{font-size:30px;font-weight:400;line-height:1.3;margin-top:22px}
.by{font-size:24px;font-weight:400;color:${INK2};margin-top:32px}
.frame{position:absolute;right:0;top:0;width:${FRAME_W}px;height:${H}px;${frameStyle}}
.art{position:absolute;left:50%;top:50%;width:${Math.round(FRAME_W * 0.8)}px;height:${Math.round(FRAME_W * 0.8 * 4 / 3)}px;transform:translate(-50%,-50%);display:block}
.photo{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
</style></head><body>
<div class="left">
  ${badge ? `<div class="badge">${esc(badge)}</div>` : ''}
  <h1>${esc(title)}</h1>
  ${sub ? `<div class="sub">${esc(sub)}</div>` : ''}
  <div class="by">${esc(by)}</div>
</div>
<div class="frame">${inner}</div>
</body></html>`;

const cards = [
  ...PROJECTS.map((p) => ({
    file: `${p.slug}.png`,
    html: page({
      badge: p.badge, title: p.short, sub: p.subtitle,
      by: `${PROFILE.name} · Iowa State University`,
      frameStyle: p.frame,
      inner: `<img class="art" src="${dataUri(p.art.replace(/^\//, 'public/'), 'image/svg+xml')}" alt="">`,
    }),
  })),
  {
    file: 'site.png',
    html: page({
      badge: '', title: PROFILE.name, sub: PROFILE.tagline,
      by: 'Iowa State University · akshatvalse.com',
      frameStyle: 'background:#f2f2f2;',
      inner: `<img class="photo" src="${dataUri('public/img/portrait-960.webp', 'image/webp')}" alt="">`,
    }),
  },
];

const OUT = path.join(ROOT, 'public', 'og');
mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'shell' });
try {
  const tab = await browser.newPage();
  await tab.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  for (const c of cards) {
    await tab.setContent(c.html, { waitUntil: 'load' });
    await tab.evaluate(() => document.fonts.ready);
    if (!(await tab.evaluate(() => document.fonts.check('700 20px Poppins')))) {
      throw new Error('Poppins did not load (is there a network connection?); refusing to write a card in a fallback font');
    }
    const raw = await tab.screenshot();
    const out = path.join(OUT, c.file);
    // Quantized PNG: flat colour and type, where JPEG rings around the letters.
    await sharp(raw).png({ quality: 85, compressionLevel: 9, palette: true }).toFile(out);
    console.log(`og/${c.file}  ${W}x${H}  ${(readFileSync(out).length / 1024).toFixed(1)} KB`);
  }
} finally {
  await browser.close();
}
