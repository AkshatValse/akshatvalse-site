// Cover art for /research/neural-pde-stability (MTAN theme), 1200 x 1600, full bleed.
// Usage (from the site root):  node scripts/cover-art/neural-pde-stability.mjs [out.svg]
// Without an argument it writes public/research/neural-pde-stability/cover-art.svg (resolved relative
// to this file at scripts/cover-art/). Node built-ins only, no randomness: two runs give identical bytes.
//
// "Cells". Fifteen tall rounded columns of equal width stand side by side across the frame. Their
// heights follow one smooth bump, so the row reads at a glance as a single soft mound of light made of
// cells. Each column glows coral low down, warming through peach to apricot at its tip (the tallest
// tips touch cream), and dissolves into the dusk at the bottom edge. Behind the mound: a purple-to-plum
// sky with one large, faint coral glow centred over the peak.
//
// Public idea only (from the project page): cell-average neural network solvers advance a PDE solution
// by updating the average held in each cell of a grid, and the question is when they stay stable. The
// bump is an art shape (a Gaussian profile chosen for its look), not data or a computed solution. It is
// deliberately calm and well behaved: no oscillation, no growth, nothing that hints at any result.
//
// Allowed SVG only: rect, circle, path, linear/radial gradients and stops. No filters, masks, text.

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---- canvas and palette (MTAN; cream is the Kaleido highlight) ----
const W = 1200, H = 1600;
const P = {
  navy: '#0f2540', purple: '#63328a', plum: '#4a1b46',
  coral: '#f08b95', peach: '#f4b798', apricot: '#f7ca9d', cream: '#fff4d6',
};

// ---- helpers ----
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, t) => '#' + rgb(a).map((v, i) => Math.round(v + (rgb(b)[i] - v) * t).toString(16).padStart(2, '0')).join('');
const n1 = (v) => String(Math.round(v * 10) / 10);
const n3 = (v) => String(Math.round(v * 1000) / 1000);
const stops = (list) => list.map(([o, c, a]) =>
  `<stop offset="${n3(o)}" stop-color="${c}"${a === undefined ? '' : ` stop-opacity="${n3(a)}"`}/>`).join('');
const smoothstep = (u) => u * u * (3 - 2 * u);
// Tip colour by relative height u in [0, 1]: coral -> peach -> apricot -> a touch of cream.
const tipColour = (u) => (u < 0.4 ? mix(P.coral, P.peach, u / 0.4)
  : u < 0.8 ? mix(P.peach, P.apricot, (u - 0.4) / 0.4)
    : mix(P.apricot, P.cream, ((u - 0.8) / 0.2) * 0.6));

// ---- the row of cells ----
const N = 15;                     // columns (odd, so one column stands at the centre)
const GAP = 24;                   // gap between columns, and the margin at each side edge
const PITCH = (W - GAP) / N;      // 78.4
const BW = PITCH - GAP;           // column width 54.4
const R = BW / 2;                 // fully rounded tops
const Y_PEAK = 400;               // top of the centre column
const Y_FOOT = 1300;              // where a column of zero bump height would end
const SIGMA = 0.6;                // bump width, in half-frame units
const FADE_TOP = 1140;            // columns are fully opaque above this line ...
const COLOUR_FROM = 1300;         // ... and start warming from coral above this one

const cols = Array.from({ length: N }, (_, k) => {
  const cx = GAP + PITCH * k + BW / 2;
  const t = (cx - W / 2) / (W / 2);
  const u = Math.exp(-(t * t) / (2 * SIGMA * SIGMA));
  return { k, u, x: cx - BW / 2, y: Y_FOOT + (Y_PEAK - Y_FOOT) * u };
});
const colPath = ({ x, y }) =>
  `M${n1(x)} ${H}V${n1(y + R)}A${n1(R)} ${n1(R)} 0 0 1 ${n1(x + BW)} ${n1(y + R)}V${H}Z`;

// Each column: opacity rises on a smoothstep from 0 at the bottom edge to 1 at FADE_TOP (no kink, so
// no Mach band), while its colour runs from coral to its own tip colour between COLOUR_FROM and its top.
const colGradient = (c) => {
  const span = H - c.y, at = (y) => (H - y) / span, tip = tipColour(c.u);
  const colour = (y) => mix(P.coral, tip, Math.min(1, Math.max(0, (COLOUR_FROM - y) / (COLOUR_FROM - c.y))));
  const fade = [0, 0.25, 0.5, 0.75, 1].map((s) => {
    const y = H - s * (H - FADE_TOP);
    return [at(y), colour(y), smoothstep(s)];
  });
  return `<linearGradient id="c${c.k}" x1="0" y1="${H}" x2="0" y2="${n1(c.y)}" gradientUnits="userSpaceOnUse">` +
    stops([...fade, [1, tip]]) + '</linearGradient>';
};

// ---- assemble ----
const GLOW = { cx: 600, cy: 560, r: 720 };
const defs = [
  `<linearGradient id="sky" x1="0" y1="0" x2="0" y2="${H}" gradientUnits="userSpaceOnUse">` +
    stops([[0, P.purple], [0.62, P.plum], [1, P.plum]]) + '</linearGradient>',
  `<radialGradient id="glow" cx="${GLOW.cx}" cy="${GLOW.cy}" r="${GLOW.r}" gradientUnits="userSpaceOnUse">` +
    stops([[0, P.coral, 0.24], [0.45, P.coral, 0.08], [1, P.coral, 0]]) + '</radialGradient>',
  ...cols.map(colGradient),
];
const body = [
  `<rect width="${W}" height="${H}" fill="url(#sky)"/>`,
  `<circle cx="${GLOW.cx}" cy="${GLOW.cy}" r="${GLOW.r}" fill="url(#glow)"/>`,
  ...cols.map((c) => `<path d="${colPath(c)}" fill="url(#c${c.k})"/>`),
];

// ---- checks ----
if (GAP < 24 || BW < 24) throw new Error('feature smaller than 24 px');
if (Math.abs(cols[N - 1].x + BW + GAP - W) > 1e-6) throw new Error('row is not centred');
if (cols.some((c) => c.y + R > FADE_TOP - 24)) throw new Error('a column tip sits inside the fade');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">\n` +
  `<defs>\n${defs.join('\n')}\n</defs>\n${body.join('\n')}\n</svg>\n`;
if (svg.length > 40 * 1024) throw new Error(`svg too large (${svg.length} bytes)`);
const dest = process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), '../../public/research/neural-pde-stability/cover-art.svg');
writeFileSync(dest, svg);
console.log(`wrote ${dest} (${svg.length} bytes)`);
