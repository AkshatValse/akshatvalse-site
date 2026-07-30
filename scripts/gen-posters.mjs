/**
 * Build-time poster frames.
 *
 * Every simulation on the site paints something correct before any JavaScript
 * runs. That serves three readers at once: the one on a slow connection who
 * sees the figure at first paint with no layout shift, the one who has asked
 * for reduced motion and never starts a loop, and the one with JavaScript
 * disabled entirely.
 *
 * The hero is a raster (WebP, one per colour scheme) because it is a dense
 * field. The diffusivity figure is emitted as SVG instead: it is a line chart,
 * so SVG is smaller, stays sharp, keeps its tick labels as real selectable
 * text, and picks up the page's own colour tokens, which means one file covers
 * both schemes.
 *
 * Colour tokens are parsed out of src/styles/global.css rather than restated
 * here, so the poster and the live canvas cannot drift apart.
 *
 * Run: node scripts/gen-posters.mjs   (also runs as part of `npm run build`)
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';

import { HeroSim, HERO_DEFAULTS } from '../src/sim/hero.js';
import { contourRGBA, contourFieldRGBA, rampTable, rampIndex, splatDisc, flattenOnto } from '../src/sim/render.js';
import { cividis } from '../src/sim/cividis.js';
import { DiffusionSampler, DIFFUSION_DEFAULTS } from '../src/sim/diffusion.js';
import { BOX, energy, energyGrad } from '../src/sim/mixture.js';
import { DiffusivitySim, D_EFF_EXACT } from '../src/sim/diffusivity.js';
import { RareTailSim, normalTail } from '../src/sim/raretail.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public', 'poster');
const GENERATED = path.join(ROOT, 'src', 'generated');
mkdirSync(PUBLIC, { recursive: true });
mkdirSync(GENERATED, { recursive: true });

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

const CSS = readFileSync(path.join(ROOT, 'src', 'styles', 'global.css'), 'utf8');

function tokens(scheme) {
  // The dark values live inside the prefers-color-scheme block; take the last
  // occurrence for dark and the first for light.
  const darkBlock = CSS.slice(CSS.indexOf('@media (prefers-color-scheme: dark)'));
  const src = scheme === 'dark' ? darkBlock : CSS.slice(0, CSS.indexOf('@media'));
  const get = (name) => {
    const m = src.match(new RegExp(`--${name}:\\s*([^;]+);`));
    if (!m) throw new Error(`token --${name} not found for scheme ${scheme}`);
    return m[1].trim();
  };
  return {
    simBg: hex(get('sim-bg')),
    simContour: hex(get('sim-contour')),
    reverse: get('sim-reverse') === '1',
  };
}

function hex(s) {
  const m = s.match(/^#([0-9a-f]{6})$/i);
  if (!m) throw new Error(`expected a 6-digit hex colour, got "${s}"`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// ---------------------------------------------------------------------------
// Hero poster
// ---------------------------------------------------------------------------

/** Matches SIM_SPEED / TRAIL_FADE / START_TIME in src/scripts/hero.client.js. */
const START_TIME = 2.0;
const TRAIL_FRAMES = 14;
const STEPS_PER_FRAME = 3;
const TRAIL_FADE = 0.085;

const HERO_W = 1440, HERO_H = 480;
const HERO_TILES = { tilesX: 6, tilesY: 2 };
const RAMP_STEPS = 96;

async function heroPoster(scheme) {
  const tk = tokens(scheme);
  const buf = contourRGBA(
    HERO_W, HERO_H,
    2 * Math.PI * HERO_TILES.tilesX,
    2 * Math.PI * HERO_TILES.tilesY,
    tk.simContour, 0.24, 0.75
  );

  const sim = new HeroSim({ ...HERO_DEFAULTS, ...HERO_TILES });
  const lead = Math.round(START_TIME / sim.dt) - TRAIL_FRAMES * STEPS_PER_FRAME;
  sim.advance(Math.max(0, lead));

  const ramp = rampTable(RAMP_STEPS, tk.reverse);
  const sx = HERO_W / sim.spanX, sy = HERO_H / sim.spanY;
  const r = 2.0;

  // Replay the last few frames with the same geometric alpha ramp the live
  // canvas produces, so the poster carries the same trails.
  for (let f = 0; f < TRAIL_FRAMES; f++) {
    sim.advance(STEPS_PER_FRAME);
    const alpha = Math.pow(1 - TRAIL_FADE, TRAIL_FRAMES - 1 - f);
    for (let i = 0; i < sim.n; i++) {
      const c = ramp[rampIndex(sim.x[i], sim.y[i], RAMP_STEPS)];
      splatDisc(buf, HERO_W, HERO_H, sim.x[i] * sx, HERO_H - sim.y[i] * sy, r, c, alpha);
    }
  }

  flattenOnto(buf, tk.simBg);

  // AVIF first, WebP as the fallback source, each at two widths. A phone
  // fetches exactly one file at 720w; the poster is the only raster on the site.
  const raw = () => sharp(Buffer.from(buf.buffer), {
    raw: { width: HERO_W, height: HERO_H, channels: 4 },
  });
  const sizes = {};
  for (const w of [720, 1080, HERO_W]) {
    const a = await raw().resize(w).avif({ quality: 45, effort: 6 })
      .toFile(path.join(PUBLIC, `hero-${scheme}-${w}.avif`));
    const b = await raw().resize(w).webp({ quality: 62, effort: 6 })
      .toFile(path.join(PUBLIC, `hero-${scheme}-${w}.webp`));
    sizes[w] = { avif: a.size, webp: b.size };
  }

  return { sizes, t: sim.t };
}

// ---------------------------------------------------------------------------
// Diffusion-sampler poster
// ---------------------------------------------------------------------------

const DIF_W = 1200, DIF_H = 600;
const ENERGY_SPAN = 9;

const PHI_MIN = (() => {
  let m = Infinity;
  for (let i = 0; i <= 240; i++)
    for (let j = 0; j <= 120; j++) {
      const v = energy(
        BOX.x0 + ((BOX.x1 - BOX.x0) * i) / 240,
        BOX.y0 + ((BOX.y1 - BOX.y0) * j) / 120
      );
      if (v < m) m = v;
    }
  return m;
})();

async function diffusionPoster(scheme) {
  const tk = tokens(scheme);
  const buf = contourFieldRGBA(DIF_W, DIF_H, BOX, energyGrad, tk.simContour, {
    alpha: 0.34,
    halfWidthPx: 0.75,
    spacing: 1.0,
    cutoff: PHI_MIN + ENERGY_SPAN,
  });

  // The poster shows a completed pass: the samples on target, which is the
  // informative frame for a reader who never starts the loop.
  const sim = new DiffusionSampler({ ...DIFFUSION_DEFAULTS, seed: 'poster/vp-sde' });
  sim.advance(sim.steps);

  const sx = DIF_W / (BOX.x1 - BOX.x0);
  const sy = DIF_H / (BOX.y1 - BOX.y0);
  for (let i = 0; i < sim.n; i++) {
    const u = (energy(sim.x[i], sim.y[i]) - PHI_MIN) / ENERGY_SPAN;
    const t = u < 0 ? 0 : u > 1 ? 1 : u;
    const c = cividis(tk.reverse ? 1 - t : t);
    splatDisc(buf, DIF_W, DIF_H, (sim.x[i] - BOX.x0) * sx, (BOX.y1 - sim.y[i]) * sy, 2.0, c, 1);
  }

  flattenOnto(buf, tk.simBg);
  const raw = () => sharp(Buffer.from(buf.buffer), {
    raw: { width: DIF_W, height: DIF_H, channels: 4 },
  });
  const avif = await raw().avif({ quality: 45, effort: 6 })
    .toFile(path.join(PUBLIC, `diffusion-${scheme}.avif`));
  const webp = await raw().webp({ quality: 62, effort: 6 })
    .toFile(path.join(PUBLIC, `diffusion-${scheme}.webp`));

  return { avif: avif.size, webp: webp.size, coverage: sim.coverage() };
}

// ---------------------------------------------------------------------------
// Diffusivity poster (SVG)
// ---------------------------------------------------------------------------

const SVG_W = 640, SVG_H = 320;
const PAD = { l: 48, r: 16, t: 26, b: 32 };
const T_MIN = 0.2, T_MAX = 1000, SAMPLES = 260;
const Y_LO = 0.4, Y_HI = 1.2;
const GROUPS = 4, REPLICAS = 1024;

const xOf = (t) =>
  PAD.l + ((Math.log(t) - Math.log(T_MIN)) / (Math.log(T_MAX) - Math.log(T_MIN))) *
    (SVG_W - PAD.l - PAD.r);
const yOf = (d) =>
  SVG_H - PAD.b - ((d - Y_LO) / (Y_HI - Y_LO)) * (SVG_H - PAD.t - PAD.b);

const n2 = (v) => Math.round(v * 100) / 100;

function diffusivityPoster() {
  const sim = new DiffusivitySim({ replicas: REPLICAS });
  const schedule = Array.from({ length: SAMPLES }, (_, i) =>
    Math.exp(Math.log(T_MIN) + ((Math.log(T_MAX) - Math.log(T_MIN)) * i) / (SAMPLES - 1))
  );

  const pts = [];
  let next = 0;
  const g = REPLICAS / GROUPS;
  while (sim.t < T_MAX) {
    sim.advance(10);
    while (next < schedule.length && sim.t >= schedule[next]) {
      const per = [];
      for (let k = 0; k < GROUPS; k++) per.push(sim.estimate(k * g, (k + 1) * g));
      const m = per.reduce((a, v) => a + v, 0) / GROUPS;
      const sd = Math.sqrt(per.reduce((a, v) => a + (v - m) ** 2, 0) / (GROUPS - 1));
      pts.push({ t: sim.t, d: sim.estimate(), se: sd / Math.sqrt(GROUPS) });
      next++;
    }
  }

  const clamp = (d) => Math.max(Y_LO, Math.min(Y_HI, d));
  const trace = pts.map((p, i) =>
    `${i ? 'L' : 'M'}${n2(xOf(p.t))} ${n2(yOf(clamp(p.d)))}`).join('');
  const band =
    pts.map((p, i) => `${i ? 'L' : 'M'}${n2(xOf(p.t))} ${n2(yOf(clamp(p.d + p.se)))}`).join('') +
    pts.slice().reverse().map((p) => `L${n2(xOf(p.t))} ${n2(yOf(clamp(p.d - p.se)))}`).join('') +
    'Z';

  const gridY = [0.4, 0.6, 0.8, 1.0, 1.2];
  const grid = gridY.map((d) =>
    `<line x1="${PAD.l}" y1="${n2(yOf(d))}" x2="${SVG_W - PAD.r}" y2="${n2(yOf(d))}"/>`).join('');
  const yLabels = gridY.map((d) =>
    `<text x="${PAD.l - 7}" y="${n2(yOf(d))}" text-anchor="end" dominant-baseline="middle">${d.toFixed(1)}</text>`).join('');

  let ticks = '', xLabels = '';
  for (let e = -1; e <= 3; e++) {
    for (let m = 1; m <= 9; m++) {
      const t = m * Math.pow(10, e);
      if (t < T_MIN || t > T_MAX) continue;
      const x = n2(xOf(t));
      const major = m === 1;
      ticks += `<line x1="${x}" y1="${SVG_H - PAD.b}" x2="${x}" y2="${SVG_H - PAD.b + (major ? 6 : 3)}"/>`;
      if (major) xLabels += `<text x="${x}" y="${SVG_H - PAD.b + 9}" text-anchor="middle" dominant-baseline="hanging">${t}</text>`;
    }
  }

  const yRef = n2(yOf(D_EFF_EXACT));
  const last = pts[pts.length - 1];

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SVG_W} ${SVG_H}" role="img" aria-label="Estimated effective diffusivity converging to the Lifson-Jackson value 0.62386.">
<style>
.g{stroke:var(--rule,#cfd6d7);stroke-width:1;fill:none}
.a{stroke:var(--ink-2,#59636a);stroke-width:1;fill:none}
.l{fill:var(--ink-2,#59636a);font:11px var(--font-mono,monospace)}
.b{fill:var(--ink-2,#59636a);opacity:.22}
.tr{stroke:var(--ink,#101619);stroke-width:1.25;fill:none;stroke-linejoin:round}
.rf{stroke:var(--ink,#101619);stroke-width:1;stroke-dasharray:6 4;fill:none}
.rl{fill:var(--ink,#101619);font:11px var(--font-mono,monospace)}
</style>
<g class="g">${grid}</g>
<g class="a">${ticks}<line x1="${PAD.l}" y1="${SVG_H - PAD.b}" x2="${SVG_W - PAD.r}" y2="${SVG_H - PAD.b}"/></g>
<g class="l">${yLabels}${xLabels}<text x="11" y="${n2((SVG_H - PAD.b + PAD.t) / 2)}" text-anchor="middle" transform="rotate(-90 11 ${n2((SVG_H - PAD.b + PAD.t) / 2)})">D_hat(t)</text><text x="${SVG_W - PAD.r}" y="${SVG_H - PAD.b - 4}" text-anchor="end">t</text></g>
<path class="b" d="${band}"/>
<path class="tr" d="${trace}"/>
<line class="rf" x1="${PAD.l}" y1="${yRef}" x2="${SVG_W - PAD.r}" y2="${yRef}"/>
<text class="rl" x="${PAD.l + 5}" y="${n2(yRef - 5)}">D_eff = 1/I&#8320;(1)&#178; = 0.62386</text>
</svg>`;

  const out = path.join(GENERATED, 'diffusivity-poster.svg');
  writeFileSync(out, svg, 'utf8');
  return { out, bytes: Buffer.byteLength(svg), last };
}

// ---------------------------------------------------------------------------
// Rare-event poster (SVG)
// ---------------------------------------------------------------------------

const RT_PAD = { l: 54, r: 16, t: 14, b: 46 };
const A_MIN = 1, A_MAX = 7, P_MIN = 1e-13, P_MAX = 1;
const RT_N = 8_000_000;
const RSE_MIN = 1e-3, RSE_MAX = 1;

const rtX = (a) =>
  RT_PAD.l + ((a - A_MIN) / (A_MAX - A_MIN)) * (SVG_W - RT_PAD.l - RT_PAD.r);
const rtY = (v) =>
  SVG_H - RT_PAD.b -
  ((Math.log10(v) - Math.log10(P_MIN)) / (Math.log10(P_MAX) - Math.log10(P_MIN))) *
    (SVG_H - RT_PAD.t - RT_PAD.b);

/** Relative standard error mapped through cividis, as a hex string. */
function rseHex(rse, reverse) {
  const u =
    (Math.log10(Math.max(rse, 1e-9)) - Math.log10(RSE_MIN)) /
    (Math.log10(RSE_MAX) - Math.log10(RSE_MIN));
  const t = u < 0 ? 0 : u > 1 ? 1 : u;
  const [r, g, b] = cividis(reverse ? 1 - t : t);
  const hx = (v) => Math.round(v).toString(16).padStart(2, '0');
  return `#${hx(r)}${hx(g)}${hx(b)}`;
}

function rareTailPoster() {
  const sim = new RareTailSim();
  const BATCH = 200_000;
  while (sim.n < RT_N) sim.advance(Math.min(BATCH, RT_N - sim.n));

  const clamp = (v) => Math.max(P_MIN, Math.min(P_MAX, v));

  // Exact curve.
  let exact = '';
  for (let i = 0; i <= 160; i++) {
    const a = A_MIN + ((A_MAX - A_MIN) * i) / 160;
    exact += `${i ? 'L' : 'M'}${n2(rtX(a))} ${n2(rtY(normalTail(a)))}`;
  }

  // The two colour schemes differ only in the ramp direction, so the markers
  // are emitted twice and CSS shows one set.
  const markers = (reverse) => {
    let s = '';
    for (const e of sim.est) {
      const x = rtX(e.a);
      const c = e.crude(), is = e.is();
      if (c) {
        const col = rseHex(c.se / c.p, reverse);
        s += `<line x1="${n2(x - 2.2)}" y1="${n2(rtY(clamp(c.p + c.se)))}" x2="${n2(x - 2.2)}" y2="${n2(rtY(clamp(c.p - c.se)))}" stroke="${col}"/>`;
        s += `<circle cx="${n2(x - 2.2)}" cy="${n2(rtY(c.p))}" r="3.1" fill="none" stroke="${col}" stroke-width="1.4"/>`;
      }
      if (is) {
        const col = rseHex(is.se / is.p, reverse);
        s += `<line x1="${n2(x + 2.2)}" y1="${n2(rtY(clamp(is.p + is.se)))}" x2="${n2(x + 2.2)}" y2="${n2(rtY(clamp(is.p - is.se)))}" stroke="${col}"/>`;
        s += `<circle cx="${n2(x + 2.2)}" cy="${n2(rtY(is.p))}" r="3.1" fill="${col}"/>`;
      }
    }
    return s;
  };

  let grid = '', yLab = '';
  for (let e = 0; e >= -13; e -= 2) {
    const y = n2(rtY(Math.pow(10, e)));
    grid += `<line x1="${RT_PAD.l}" y1="${y}" x2="${SVG_W - RT_PAD.r}" y2="${y}"/>`;
    yLab += `<text x="${RT_PAD.l - 7}" y="${y}" text-anchor="end" dominant-baseline="middle">${e === 0 ? '1' : `1e${e}`}</text>`;
  }
  let ticks = '', xLab = '';
  for (let a = A_MIN; a <= A_MAX; a += 1) {
    const x = n2(rtX(a));
    ticks += `<line x1="${x}" y1="${SVG_H - RT_PAD.b}" x2="${x}" y2="${SVG_H - RT_PAD.b + 5}"/>`;
    xLab += `<text x="${x}" y="${SVG_H - RT_PAD.b + 8}" text-anchor="middle" dominant-baseline="hanging">${a}</text>`;
  }

  const reach = sim.reach();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SVG_W} ${SVG_H}" role="img" aria-label="Gaussian tail probability against threshold, on a logarithmic axis. Importance sampling tracks the exact curve down to 10 to the minus 12, while crude Monte Carlo stops producing estimates below about 10 to the minus 7.">
<style>
.g{stroke:var(--rule,#cfd6d7);stroke-width:1;fill:none}
.a{stroke:var(--ink-2,#59636a);stroke-width:1;fill:none}
.l{fill:var(--ink-2,#59636a);font:11px var(--font-mono,monospace)}
.rf{stroke:var(--ink,#101619);stroke-width:1;stroke-dasharray:6 4;fill:none}
.dark{display:none}
@media (prefers-color-scheme: dark){.light{display:none}.dark{display:inline}}
</style>
<g class="g">${grid}</g>
<g class="a">${ticks}<line x1="${RT_PAD.l}" y1="${SVG_H - RT_PAD.b}" x2="${SVG_W - RT_PAD.r}" y2="${SVG_H - RT_PAD.b}"/></g>
<g class="l">${yLab}${xLab}<text x="${n2((RT_PAD.l + SVG_W - RT_PAD.r) / 2)}" y="${SVG_H - RT_PAD.b + 24}" text-anchor="middle" dominant-baseline="hanging">threshold a</text><text x="13" y="${n2((SVG_H - RT_PAD.b + RT_PAD.t) / 2)}" text-anchor="middle" transform="rotate(-90 13 ${n2((SVG_H - RT_PAD.b + RT_PAD.t) / 2)})">P(Z &gt; a)</text></g>
<path class="rf" d="${exact}"/>
<g class="light">${markers(false)}</g>
<g class="dark">${markers(true)}</g>
</svg>`;

  const out = path.join(GENERATED, 'raretail-poster.svg');
  writeFileSync(out, svg, 'utf8');
  return { bytes: Buffer.byteLength(svg), n: sim.n, reach };
}

// ---------------------------------------------------------------------------

const t0 = Date.now();
const light = await heroPoster('light');
const dark = await heroPoster('dark');
const dsLight = await diffusionPoster('light');
const dsDark = await diffusionPoster('dark');
const diff = diffusivityPoster();
const rt = rareTailPoster();

console.log('poster frames');
for (const [name, r] of [['hero-light', light], ['hero-dark', dark]]) {
  for (const w of [720, 1080, HERO_W]) {
    console.log(`  ${name}-${w}   ${(r.sizes[w].avif / 1024).toFixed(1)} KB avif / ${(r.sizes[w].webp / 1024).toFixed(1)} KB webp`);
  }
}
console.log(`  hero poster rendered at t = ${light.t.toFixed(2)}`);
console.log(`  diffusion-light  ${(dsLight.avif / 1024).toFixed(1)} KB avif / ${(dsLight.webp / 1024).toFixed(1)} KB webp   (${DIF_W}x${DIF_H})`);
console.log(`  diffusion-dark   ${(dsDark.avif / 1024).toFixed(1)} KB avif / ${(dsDark.webp / 1024).toFixed(1)} KB webp`);
console.log(`  mode coverage    max |w_hat - w| = ${dsLight.coverage.maxDev.toFixed(4)}`);
console.log(`  diffusivity-poster.svg   ${(diff.bytes / 1024).toFixed(1)} KB   (${SAMPLES} samples to t = ${T_MAX})`);
console.log(`  final D_hat              ${diff.last.d.toFixed(5)} ± ${diff.last.se.toFixed(5)}   vs exact ${D_EFF_EXACT.toFixed(5)}`);
console.log(`  raretail-poster.svg      ${(rt.bytes / 1024).toFixed(1)} KB   (n = ${rt.n.toLocaleString()} per method per threshold)`);
console.log(`  reach                    crude ${rt.reach.crude ? rt.reach.crude.toExponential(1) : 'n/a'}  vs  IS ${rt.reach.is ? rt.reach.is.toExponential(1) : 'n/a'}`);
console.log(`  elapsed                  ${((Date.now() - t0) / 1000).toFixed(1)} s`);
