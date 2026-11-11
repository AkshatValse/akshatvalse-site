/**
 * Social cards.
 *
 * Writes the images that link previews show on X, LinkedIn, Slack, Bluesky and
 * anywhere else a page of the site is shared:
 *
 *   public/og/<slug>-r<N>.png  one per research project, set like that project's
 *                          title page: the title in regular-weight Poppins,
 *                          the authors and affiliation in italics and the
 *                          venue or stage in small capitals, on white, with
 *                          the cover artwork inset in its themed frame
 *   public/og/site-r<N>.png    every other page: the name, the tagline and the
 *                          portrait in the same frame
 *
 * Everything comes from the same data as the site (src/data/projects.ts,
 * themes.ts, site.ts, the cover-art SVGs, the portrait, and the authors,
 * affiliation and venue props of each project page), so a card cannot drift
 * from the page it advertises. Type follows the site's: Poppins at regular and
 * light weights, never bold (the site sets its titles in regular weight), loaded
 * from Google Fonts by headless Chrome, so this needs a network connection.
 *
 * N is OG_REV in src/data/site.ts: bump it when you regenerate, because the CDN and
 * the social sites cache /og/* by URL for days. The output is committed rather than generated during `npm run build`, so a
 * Linux build box never has to reproduce it. Re-run after changing a project's
 * title, subtitle, stage, theme or artwork, the tagline, or the portrait:
 *
 *   node scripts/gen-og.mjs      (needs Chrome; set CHROME_PATH if it is elsewhere)
 *
 * Layout rules: the copy stays above the bottom 130px of the left column because
 * X draws the page title over the bottom left of a large-image card.
 */
import { register } from 'node:module';
import { readFileSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
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
const { PROFILE, OG_REV } = await import(pathToFileURL(path.join(ROOT, 'src/data/site.ts')).href);

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

const page = ({ title, lines, info, frameStyle, inner, big }) => `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Poppins:ital,wght@0,300;0,400;0,500;1,300;1,400;1,500&display=block" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{width:${W}px;height:${H}px;background:#fff;overflow:hidden;font-family:'Poppins',sans-serif;color:${INK}}
.left{position:absolute;left:64px;top:64px;width:${W - FRAME_W - 64 - 56}px}
h1{font-weight:${big ? 400 : 400};font-size:${big ? 80 : 54}px;line-height:1.22;letter-spacing:0}
.l{font-size:23px;font-weight:300;font-style:italic;line-height:1.45;margin-top:10px}
.l.first{margin-top:26px}
.l.plain{font-style:normal;font-size:${big ? 34 : 23}px;line-height:1.35}
.info{font-size:17px;font-weight:500;letter-spacing:.14em;text-transform:uppercase;color:${INK2};margin-top:30px}
.frame{position:absolute;right:0;top:0;width:${FRAME_W}px;height:${H}px;${frameStyle}}
.art{position:absolute;left:50%;top:50%;width:${Math.round(FRAME_W * 0.8)}px;height:${Math.round(FRAME_W * 0.8 * 4 / 3)}px;transform:translate(-50%,-50%);display:block}
.photo{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
</style></head><body>
<div class="left" id="left">
  <h1 id="t">${esc(title)}</h1>
  ${lines.map((l, i) => `<div class="l${i === 0 ? ' first' : ''}${l.plain ? ' plain' : ''}">${esc(l.text)}</div>`).join('\n  ')}
  ${info ? `<div class="info">${esc(info)}</div>` : ''}
</div>
<div class="frame">${inner}</div>
<script>
// Called once the fonts are in: shrink the title until the copy ends above the
// bottom 130px of the card, where X draws the page title over a large-image card.
window.fit = () => {
  const t = document.getElementById('t'), box = document.getElementById('left');
  let size = parseFloat(getComputedStyle(t).fontSize);
  while (box.offsetHeight > ${H - 130 - 64} && size > 30) { size -= 2; t.style.fontSize = size + 'px'; }
  return size;
};
</script>
</body></html>`;

/** authors, affiliation and venue/stage of a project page, as its ProjectLayout props state them. */
function pageMeta(slug) {
  const src = readFileSync(path.join(ROOT, 'src/pages/research', `${slug}.astro`), 'utf8');
  const prop = (n) => {
    const m = src.match(new RegExp(`^\\s+${n}="([^"]*)"`, 'm'));
    if (!m) throw new Error(`${slug}.astro: no ${n}="..." prop for the social card`);
    return m[1];
  };
  return { authors: prop('authors'), affiliation: prop('affiliation'), info: prop('info') };
}

const cards = [
  ...PROJECTS.map((p) => {
    const m = pageMeta(p.slug);
    return {
      file: `${p.slug}-r${OG_REV}.png`,
      html: page({
        title: p.title, lines: [{ text: m.authors }, { text: m.affiliation }], info: m.info,
        frameStyle: p.frame,
        inner: `<img class="art" src="${dataUri(p.art.replace(/^\//, 'public/'), 'image/svg+xml')}" alt="">`,
      }),
    };
  }),
  {
    file: `site-r${OG_REV}.png`,
    html: page({
      big: true, title: PROFILE.name,
      lines: [{ text: PROFILE.tagline, plain: true }, { text: 'Iowa State University' }], info: 'akshatvalse.com',
      frameStyle: 'background:#f2f2f2;',
      inner: `<img class="photo" src="${dataUri('public/img/portrait-960.webp', 'image/webp')}" alt="">`,
    }),
  },
];

const OUT = path.join(ROOT, 'public', 'og');
mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) if (f.endsWith('.png')) rmSync(path.join(OUT, f)); // stale revisions
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'shell' });
try {
  const tab = await browser.newPage();
  await tab.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  for (const c of cards) {
    await tab.setContent(c.html, { waitUntil: 'load' });
    await tab.evaluate(() => document.fonts.ready);
    if (!(await tab.evaluate(() => document.fonts.check('400 20px Poppins') && document.fonts.check('italic 300 20px Poppins')))) {
      throw new Error('Poppins did not load (is there a network connection?); refusing to write a card in a fallback font');
    }
    const size = await tab.evaluate(() => window.fit());
    const raw = await tab.screenshot();
    const out = path.join(OUT, c.file);
    // Quantized PNG: flat colour and type, where JPEG rings around the letters.
    await sharp(raw).png({ quality: 85, compressionLevel: 9, palette: true }).toFile(out);
    console.log(`og/${c.file}  ${W}x${H}  title ${size}px  ${(readFileSync(out).length / 1024).toFixed(1)} KB`);
  }
} finally {
  await browser.close();
}
