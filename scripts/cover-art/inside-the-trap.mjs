// Cover art for /research/inside-the-trap (Kaleido theme), concept B: "The whirl".
// Run from the site root:  node scripts/cover-art/inside-the-trap.mjs [out.svg]
// Writes public/research/inside-the-trap/cover-art.svg by default (path resolved from this file).
// Node built-ins only, no randomness: running it twice gives byte-identical output.
//
// Idea (public, from the project page): after a burst, a serving engine can fall into a bad state
// and stay stuck there, even at a load it handled before. The emblem is a loose metaphor for that:
// one chambered whirl that fills the frame, its cells stepping from warm peach and pink at the rim
// through lilac and violet to blue and a navy comma at the centre, so the eye is pulled round and
// inward into a place it does not leave. It is an art shape, not data: no number, curve or result
// from the paper is drawn, and the way out (the session cap) is not shown.
//
// Technique: a conformal spiral tiling. In log-polar coordinates (rho = ln r, theta) the band
// between two windings of a logarithmic spiral is a straight strip; it is cut into equal
// parallelogram cells and mapped to the plane by (rho, theta) -> eye + e^rho (cos theta, sin theta).
// Every cell edge is then an arc of a logarithmic spiral, drawn as cubic Beziers from the exact
// tangents. Each cell gets one colour from the ramp and a gentle two-stop lightening along the
// spiral, so the cells overlap like scales.

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---- CANVAS + PALETTE (Kaleido, plus the deep accents allowed for it) ----
const W = 1200, H = 1600;
const P = {
  sky: '#9bd4e5', blue: '#5fa9d4', pink: '#f8c7d8', lilac: '#e1c4f4',
  cream: '#fff4d6', butter: '#fceabb', navy: '#0f2540', white: '#ffffff',
  coral: '#f08b95', peach: '#f4b798', apricot: '#f7ca9d', violet: '#9180e8',
};

// ---- COLOUR HELPERS ----
const hex2rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const rgb2hex = (c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
const mix = (a, b, k) => { const A = hex2rgb(a), B = hex2rgb(b); return rgb2hex(A.map((v, i) => v + (B[i] - v) * k)); };

// ---- CONFIG ----
const CFG = {
  eye: { x: 660, y: 880 },   // where the whirl closes (px)
  perTurn: 7,                // cells per full turn
  growth: 1.10,              // ln(radius ratio) from one winding to the next
  twist: 0.21,               // extra theta per cell step (rad); sweeps the cell walls into arms
  theta0: -0.3,              // rotation of the whole whirl (rad); chosen so the frame edges cut only
                             // large cells (no small peach wedge in a corner, no thin edge sliver)
  rCore: 95,                 // the navy core ends at about this radius (px)
  shadeStep: 0.10,           // each cell's inner end takes the ramp colour this much further out...
  shadeWhite: 0.06,          // ...mixed this much toward white, so cells overlap like scales
  // colour ramp by log radius, from the core (t = 0) to the farthest corner (t = 1);
  // the first stop is blue mixed 30% toward navy (a 10%-step tint, as the palette rules allow)
  ramp: [
    [0.00, mix(P.blue, P.navy, 0.3)], [0.15, P.blue], [0.40, P.violet], [0.60, P.lilac],
    [0.80, P.pink], [1.00, P.peach],
  ],
};

// ---- HELPERS ----
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const rampAt = (t) => {
  const s = CFG.ramp;
  if (t <= s[0][0]) return s[0][1];
  for (let i = 1; i < s.length; i++) {
    if (t <= s[i][0]) return mix(s[i - 1][1], s[i][1], (t - s[i - 1][0]) / (s[i][0] - s[i - 1][0]));
  }
  return s[s.length - 1][1];
};
const f = (n) => String(Math.round(n * 10) / 10);

// log-polar point -> plane
const E = CFG.eye;
const pt = (rho, th) => { const r = Math.exp(rho); return [E.x + r * Math.cos(th), E.y + r * Math.sin(th)]; };

// A straight segment in (rho, theta) is an arc of a log spiral. With z(t) = eye + exp(w0 + t*delta),
// z'(t) = delta * (z - eye): cubic Hermite -> Bezier with handles delta*(z - eye)/3, split into
// pieces of at most 0.3 in rho and theta so the cubic stays within a fraction of a pixel.
function arc(p0, p1) {
  const dr = p1[0] - p0[0], dt = p1[1] - p0[1];
  const m = Math.max(1, Math.ceil(Math.max(Math.abs(dt), Math.abs(dr)) / 0.3));
  const ur = dr / m, ut = dt / m;
  const tan = (z) => [ur * (z[0] - E.x) - ut * (z[1] - E.y), ur * (z[1] - E.y) + ut * (z[0] - E.x)];
  let d = '';
  for (let k = 0; k < m; k++) {
    const za = pt(p0[0] + ur * k, p0[1] + ut * k), zb = pt(p0[0] + ur * (k + 1), p0[1] + ut * (k + 1));
    const ta = tan(za), tb = tan(zb);
    d += `C${f(za[0] + ta[0] / 3)},${f(za[1] + ta[1] / 3)} ${f(zb[0] - tb[0] / 3)},${f(zb[1] - tb[1] / 3)} ${f(zb[0])},${f(zb[1])}`;
  }
  return d;
}

// ---- GEOMETRY ----
// One cell step along the spiral is e2 = (g, b). N steps plus e1 return to the same plane point,
// so e1 = (0, 2 pi) - N e2 crosses exactly one winding (inward, since g > 0).
const N = CFG.perTurn;
const b = (2 * Math.PI) / N + CFG.twist;
const g = (CFG.growth * b) / (2 * Math.PI);
const e2 = [g, b];
const e1 = [-N * g, 2 * Math.PI - N * b];
const at = (u, v) => [u * e1[0] + v * e2[0], CFG.theta0 + u * e1[1] + v * e2[1]];
// The core is every cell inside index j0: together they fill the region bounded by one full turn
// of the spiral and the cell wall that closes it, a navy comma at the centre.
const j0 = Math.ceil(Math.log(CFG.rCore) / g);
const rhoCore = at(0, j0)[0];
const rhoMax = Math.log(Math.hypot(Math.max(E.x, W - E.x), Math.max(E.y, H - E.y)));

const cells = [];
for (let j = j0; j <= j0 + 200; j++) {
  const rs = [at(0, j)[0], at(1, j)[0], at(0, j + 1)[0], at(1, j + 1)[0]];
  if (Math.min(...rs) > rhoMax + 0.05) break;
  const mid = at(0.5, j + 0.5);
  // overlap neighbours by about 1.5 px so no hairline seam shows between cells
  const eps = 1.5 / (Math.exp(mid[0]) * Math.hypot(e2[0], e2[1]));
  const A = at(-eps, j - eps), B = at(-eps, j + 1 + eps), C = at(1 + eps, j + 1 + eps), D = at(1 + eps, j - eps);
  const z = pt(...A);
  const t = clamp01((mid[0] - rhoCore) / (rhoMax - rhoCore));
  cells.push({
    t,
    g0: pt(...at(0.5, j)), g1: pt(...at(0.5, j + 1)),   // gradient runs along the spiral
    d: `M${f(z[0])},${f(z[1])}${arc(A, B)}${arc(B, C)}${arc(C, D)}${arc(D, A)}Z`,
  });
}

const c0 = pt(...at(0, j0 - N));
const core = `M${f(c0[0])},${f(c0[1])}${arc(at(0, j0 - N), at(0, j0))}${arc(at(0, j0), at(1, j0))}Z`;

// ---- SVG ----
let defs = '', paths = '';
cells.forEach((c, i) => {
  const k = rampAt(c.t), light = mix(rampAt(c.t + CFG.shadeStep), P.white, CFG.shadeWhite);
  defs += `<linearGradient id="c${i}" gradientUnits="userSpaceOnUse" x1="${f(c.g0[0])}" y1="${f(c.g0[1])}" x2="${f(c.g1[0])}" y2="${f(c.g1[1])}">`
    + `<stop offset="0" stop-color="${light}"/><stop offset="1" stop-color="${k}"/></linearGradient>\n`;
  paths += `<path d="${c.d}" fill="url(#c${i})"/>\n`;
});
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
<defs>
${defs}</defs>
<rect width="${W}" height="${H}" fill="${rampAt(0.9)}"/>
${paths}<path d="${core}" fill="${P.navy}"/>
</svg>
`;

const dest = process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), '../../public/research/inside-the-trap/cover-art.svg');
writeFileSync(dest, svg);
console.log('wrote', dest, svg.length, 'bytes,', cells.length, 'cells');
