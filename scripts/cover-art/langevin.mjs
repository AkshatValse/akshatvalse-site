// Cover art for /research/langevin (MTAN theme): "Separatrix".
// Run from the site root:  node scripts/cover-art/langevin.mjs [out.svg]
// Writes public/research/langevin/cover-art.svg (resolved from this script's folder, i.e. the site root
// when the script sits in scripts/cover-art/) unless an output path is given as the first argument.
// Node built-ins only and no randomness at all, so two runs give byte-identical output.
//
// What it is: a full-bleed field of flat, crisp terraces, the level sets of one two-well energy landscape
// seen from above. No gradients, no lines, no beads: just bands.
//
// The landscape. The project page's two-well target is an equal mixture of two Gaussians at +-mu e_0, run in
// two dimensions with s = 1; its figure draws U(x) = -log pi(x, 0) along the line through both wells. Here
// the whole 2-D U = -log pi is drawn in the plane: with u along the well axis, v across it, and up to an
// additive constant (since pi is proportional to exp(-(u^2 + v^2)/2) cosh(mu u)),
//     U(u, v) = v^2/2 + u^2/2 - log cosh(mu u).
// Minima at (+-u*, 0) with u* = mu tanh(mu u*); saddle at the origin. mu = 2 is the smallest separation in
// the page's sweep; the script computes the barrier U(0) - U(u*) = 1.307 for it (the page's
// large-separation value mu^2/2 - log 2 is also 1.307 to three places).
//
// The bands. Inside the two basins: two bands each (a dark purple floor, a purple wall), the outer edge of which is
// exactly the saddle level set, the figure-of-eight curve whose two lobes touch at one point, the saddle:
// the only way from one basin to the other. Outside it: warm terraces that step up and lighten toward the
// corners (coral, peach, apricot, cream). Inner levels are equally spaced in radius about each minimum;
// outer levels are equally spaced in distance along the well axis.
// This is a picture of the target's landscape only: no simulation, no data, no result, nothing from the
// unpublished manuscript.

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const W = 1200, H = 1600;
const CFG = {
  mu: 2,                   // well separation (first row of the page's separation sweep)
  scale: 155,              // px per unit of the landscape
  centre: [600, 800],      // the saddle sits at the centre of the canvas
  theta: -62,              // well-axis direction in screen degrees (negative: lower left to upper right)
  outerStepPx: 96,         // width of each outer terrace, px along the well axis
  N: 4096,                 // rays per contour before simplification
  tol: 0.3,                // polyline simplification tolerance, px
};

// MTAN palette (exact hex), mixed with white or with navy in 10% steps.
const P = {
  navy: '#0f2540', indigo: '#626f99', purple: '#63328a', plum: '#4a1b46',
  coral: '#f08b95', peach: '#f4b798', apricot: '#f7ca9d', cream: '#fff4d6',
};
const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const mix = (c, d, t) => '#' + hex(c).map((x, i) => Math.round(x * (1 - t) + hex(d)[i] * t).toString(16).padStart(2, '0')).join('');
const tint = (c, t) => mix(c, '#ffffff', t);               // toward white
const shade = (c, t) => mix(c, P.navy, t);                 // toward navy

// Band colours from the basin floors outward. INNER ends at the saddle level; OUTER steps up from there.
// The floor is only one tone darker than the wall (purple mixed 20% toward navy, = #522f7b): a hard plum
// floor read as two pupils, a pair of eyes, at tile size; this keeps the depth and lets each lobe read as
// one teardrop.
const INNER = [shade(P.purple, 0.2), P.purple];
const OUTER = [P.coral, tint(P.coral, 0.2), P.peach, P.apricot, tint(P.apricot, 0.2), tint(P.apricot, 0.4),
  tint(P.apricot, 0.6), P.cream, tint(P.cream, 0.4)];

// ---- the landscape ----
const { mu } = CFG;
const logcosh = (x) => { const a = Math.abs(x); return a + Math.log1p(Math.exp(-2 * a)) - Math.LN2; };
const f = (u) => (u * u) / 2 - logcosh(mu * u);          // U on the well axis (v = 0); f(0) = 0 at the saddle
const U = (u, v) => (v * v) / 2 + f(u);
let us = mu;                                               // u* = mu tanh(mu u*), fixed-point iteration
for (let i = 0; i < 200; i++) us = mu * Math.tanh(mu * us);
const Umin = f(us);
const bisect = (g, a, b) => { for (let i = 0; i < 80; i++) { const m = (a + b) / 2; if (g(a) * g(m) <= 0) b = m; else a = m; } return (a + b) / 2; };
const uEdge = bisect(f, us, 4 * mu);                       // where the saddle level crosses the axis, outside a well

// ---- canvas mapping ----
const th = (CFG.theta * Math.PI) / 180, ct = Math.cos(th), st = Math.sin(th);
const toXY = (u, v) => [CFG.centre[0] + CFG.scale * (u * ct - v * st), CFG.centre[1] + CFG.scale * (u * st + v * ct)];
const toUV = (x, y) => { const X = (x - CFG.centre[0]) / CFG.scale, Y = (y - CFG.centre[1]) / CFG.scale; return [X * ct + Y * st, -X * st + Y * ct]; };
const cornerMax = Math.max(...[[0, 0], [W, 0], [0, H], [W, H]].map(([x, y]) => U(...toUV(x, y))));

// ---- levels (band k is U < levels[k], minus the bands inside it) ----
const R0 = Math.sqrt(-2 * Umin);                           // radius of the saddle level about a minimum (quadratic part)
const levels = [];
for (let k = 1; k <= INNER.length; k++) levels.push(k === INNER.length ? 0 : Umin + ((k * R0) / INNER.length) ** 2 / 2);
for (let k = 1; ; k++) { const L = f(uEdge + (k * CFG.outerStepPx) / CFG.scale); if (L >= cornerMax) break; levels.push(L); }
const nOuter = levels.length + 1 - INNER.length;
if (nOuter > OUTER.length) throw new Error(`need ${nOuter} outer colours, have ${OUTER.length}`);
const colours = [...INNER, ...OUTER.slice(0, nOuter)];

// ---- contour tracing: march out along each ray from a point inside the region, then bisect ----
function ring(c, u0) {
  const pts = [];
  for (let i = 0; i < CFG.N; i++) {
    const a = (2 * Math.PI * i) / CFG.N, du = Math.cos(a), dv = Math.sin(a);
    const g = (r) => U(u0 + r * du, r * dv) - c;
    let r = 0;
    const step = 0.01;
    while (g(r + step) < 0) r += step;
    const rr = bisect(g, r, r + step);
    pts.push(toXY(u0 + rr * du, rr * dv));
  }
  return pts;
}
function simplify(pts, tol) {                              // Douglas-Peucker
  const keep = new Uint8Array(pts.length); keep[0] = 1; keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    const [ax, ay] = pts[i], [bx, by] = pts[j], dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1;
    let best = -1, bi = -1;
    for (let k = i + 1; k < j; k++) { const d = Math.abs((pts[k][0] - ax) * dy - (pts[k][1] - ay) * dx) / L; if (d > best) { best = d; bi = k; } }
    if (best > tol) { keep[bi] = 1; stack.push([i, bi], [bi, j]); }
  }
  return pts.filter((_, k) => keep[k]);
}
function clipRect(pts, x0, y0, x1, y1) {                   // Sutherland-Hodgman against a rectangle
  const edges = [
    [(p) => p[0] >= x0, (p, q) => [x0, p[1] + ((q[1] - p[1]) * (x0 - p[0])) / (q[0] - p[0])]],
    [(p) => p[0] <= x1, (p, q) => [x1, p[1] + ((q[1] - p[1]) * (x1 - p[0])) / (q[0] - p[0])]],
    [(p) => p[1] >= y0, (p, q) => [p[0] + ((q[0] - p[0]) * (y0 - p[1])) / (q[1] - p[1]), y0]],
    [(p) => p[1] <= y1, (p, q) => [p[0] + ((q[0] - p[0]) * (y1 - p[1])) / (q[1] - p[1]), y1]],
  ];
  let out = pts;
  for (const [inside, cut] of edges) {
    const src = out; out = [];
    for (let i = 0; i < src.length; i++) {
      const p = src[i], q = src[(i + 1) % src.length];
      if (inside(p)) { out.push(p); if (!inside(q)) out.push(cut(p, q)); } else if (inside(q)) out.push(cut(p, q));
    }
  }
  return out;
}
const n1 = (x) => (Math.round(x * 10) / 10).toString();
const sub = (pts) => 'M' + pts.map(([x, y]) => `${n1(x)} ${n1(y)}`).join('L') + 'Z';
function regionPath(c) {
  // Below the saddle level the region is two islands (one per well); at and above it, one.
  // The saddle level itself is traced a hair below 0, so its two lobes meet at the saddle point.
  const centres = c < 0 || c === 0 ? [us, -us] : [0];
  const cc = c === 0 ? -1e-9 : c;
  return centres.map((u0) => sub(simplify(clipRect(ring(cc, u0), -24, -24, W + 24, H + 24), CFG.tol))).join('');
}

// ---- assemble: the outermost band fills the canvas, then each region is laid on top, outside in ----
const body = [`<rect width="${W}" height="${H}" fill="${colours[levels.length]}"/>`];
for (let k = levels.length - 1; k >= 0; k--) body.push(`<path fill="${colours[k]}" d="${regionPath(levels[k])}"/>`);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">\n${body.join('\n')}\n</svg>\n`;
const dest = process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), '../../public/research/langevin/cover-art.svg');
writeFileSync(dest, svg);
console.log(`wrote ${dest} (${svg.length} bytes; ${levels.length} levels, ${nOuter} outer bands; u* = ${us.toFixed(4)}, barrier = ${(-Umin).toFixed(3)})`);
