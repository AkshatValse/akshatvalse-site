// Cover art for /research/online-calibration (VSL gray theme). Abstract emblem, 1200 x 1600, full bleed.
// Run from the site root:  node scripts/cover-art/online-calibration.mjs [out.svg]
// Writes public/research/online-calibration/cover-art.svg by default. Node built-ins only, no randomness:
// running it twice gives byte-identical output.
//
// Concept "The step over the line": one large staircase rises from the lower left to the right edge.
// Its outline is a running total that only ever goes up (each step is one increment, never negative).
// A single white line crosses the whole frame: the issued upper bound. Below the line the staircase is
// pale gray; from the line up it turns the one accent colour, because once the running total is past
// the bound the miss is already certain. The staircase crosses the line at the middle of the frame,
// well before the right edge (the end of the horizon). Dark slate ground, smooth 2-3 stop gradients,
// rounded step noses. The accent blue is used only on the part of the stair above the bound (no halo).
//
// Public idea (from the project page): a forecast gives an upper bound for a cumulative quantity over a
// horizon; the increments are non-negative, so once the running total crosses the bound the miss is
// certain before the horizon ends, while coverage is only confirmed at the end. The number of steps,
// their heights and the height of the line are art choices, not data or results.

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const W = 1200;
const H = 1600;
const f = (v) => String(Math.round(v * 10) / 10);

// ----------------------------------------------------------------------------------------- palette
// VSL grays and slate, one accent (blue #5fa9d4). Tints are mixes with white in 10% steps.
const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const mix = (a, b, t) => '#' + hex(a).map((v, i) => Math.round(v + (hex(b)[i] - v) * t).toString(16).padStart(2, '0')).join('');
const WHITE = '#ffffff';
const NEAR_BLACK = '#2b2d3a';
const SLATE = '#54606c';
const ACCENT = '#5fa9d4';
const GROUND = [NEAR_BLACK, SLATE]; // top -> bottom
// Pale gray, upper left -> lower right. Kept a step below the #fcfcfc line so the bound reads across the
// full width instead of merging into the stair on the right.
const STAIR = ['#d8d8d8', '#c0c4c8', '#b4bcc0'];
const OVER = [mix(ACCENT, WHITE, 0.6), mix(ACCENT, WHITE, 0.2), ACCENT]; // accent, top of stair -> line
const LINE = '#fcfcfc';

// ---------------------------------------------------------------------------------------- geometry
// Running total after each of 8 equal time steps, in px above the bottom edge (non-decreasing).
// Equal 130 px rises on both sides of the one 300 px rise that carries the stair over the bound, so it
// reads as a calm stair, not an accelerating growth curve.
const TOTALS = [170, 300, 430, 560, 860, 990, 1120, 1250];
const STEP_W = W / TOTALS.length; // 150
const BOUND = 740; // the issued upper bound, px above the bottom edge (crossed at step 5, x = 600)
const LINE_W = 28; // thickness of the bound line
const NOSE_R = 44; // radius of each step's rounded nose (convex corners); inner corners stay square
const yBound = H - BOUND;
const yTop = H - Math.max(...TOTALS);

// Staircase outline, clockwise, bleeding past the left, right and bottom edges.
// Each point is [x, y] or [x, y, radius] to force a corner radius.
function stairOutline() {
  const pts = [[-40, H + 40, 0]];
  let cur = null;
  TOTALS.forEach((t, k) => {
    const y = H - t;
    if (cur === null) { pts.push([-40, y, 0]); cur = y; return; }
    if (y !== cur) { pts.push([k * STEP_W, cur], [k * STEP_W, y]); cur = y; }
  });
  pts.push([W + 40, cur, 0], [W + 40, H + 40, 0]);
  return pts;
}

// Orthogonal polygon -> path with rounded convex corners (radius rConvex) and square inner corners.
function roundedPath(pts, rConvex) {
  let d = '';
  pts.forEach((p, i) => {
    const p0 = pts[(i - 1 + pts.length) % pts.length];
    const p1 = pts[(i + 1) % pts.length];
    const v0 = [p[0] - p0[0], p[1] - p0[1]];
    const v1 = [p1[0] - p[0], p1[1] - p[1]];
    const l0 = Math.hypot(v0[0], v0[1]);
    const l1 = Math.hypot(v1[0], v1[1]);
    const convex = v0[0] * v1[1] - v0[1] * v1[0] > 0; // clockwise turn on screen
    let r = p[2] !== undefined ? p[2] : convex ? rConvex : 0;
    r = Math.min(r, l0 / 2, l1 / 2);
    const a = [p[0] - (v0[0] / l0) * r, p[1] - (v0[1] / l0) * r];
    const b = [p[0] + (v1[0] / l1) * r, p[1] + (v1[1] / l1) * r];
    d += `${i === 0 ? 'M' : 'L'}${f(a[0])} ${f(a[1])}`;
    if (r > 0) d += `A${f(r)} ${f(r)} 0 0 1 ${f(b[0])} ${f(b[1])}`;
  });
  return d + 'Z';
}

const stair = roundedPath(stairOutline(), NOSE_R);

// ------------------------------------------------------------------------------------------- build
const stops = (cols) => cols.map((c, i) => `<stop offset="${f(i / (cols.length - 1))}" stop-color="${c}"/>`).join('');
const lin = (id, x1, y1, x2, y2, cols) =>
  `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}">${stops(cols)}</linearGradient>`;

const defs =
  lin('ground', 0, 0, 0, H, GROUND) +
  lin('stair', 300, 800, W, H, STAIR) +
  lin('over', 0, yTop, 0, yBound, OVER) +
  `<clipPath id="below"><rect x="0" y="${f(yBound)}" width="${W}" height="${f(H - yBound)}"/></clipPath>` +
  `<clipPath id="above"><rect x="0" y="0" width="${W}" height="${f(yBound)}"/></clipPath>`;

const svg =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">` +
  `<defs>${defs}</defs>` +
  `<rect width="${W}" height="${H}" fill="url(#ground)"/>` +
  `<path d="${stair}" fill="url(#stair)" clip-path="url(#below)"/>` +
  `<path d="${stair}" fill="url(#over)" clip-path="url(#above)"/>` +
  `<rect x="0" y="${f(yBound - LINE_W / 2)}" width="${W}" height="${LINE_W}" fill="${LINE}"/>` +
  `</svg>\n`;

const dest = process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), '../../public/research/online-calibration/cover-art.svg');
writeFileSync(dest, svg);
console.log(`wrote ${dest} (${svg.length} bytes)`);
