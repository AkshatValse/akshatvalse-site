// Cover art for /research/agent-reliability (Kaleido theme): "Rings". 1200 x 1600, full bleed.
// Usage: node scripts/cover-art/agent-reliability.mjs [out.svg]
// Default output: public/research/agent-reliability/cover-art.svg (resolved from this file's folder).
// Node built-ins only and no randomness: two runs give byte-identical output.
//
// Public idea (project page): long-running tool-using agents sometimes stall; when is restarting a
// stalled run worth more than waiting, and how can a failure too rare for direct simulation be
// estimated? The emblem is a loose metaphor for runs in progress, one of them stalled. It shows no
// result, number or method, and does not suggest that restarting (or waiting) is the answer.

import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const W = 1200, H = 1600;
const CX = 600, CY = 790;

// ---- palette (Kaleido + its optional deep accents) ----
const P = {
  sky: '#9bd4e5', blue: '#5fa9d4', pink: '#f8c7d8', lilac: '#e1c4f4', cream: '#fff4d6',
  butter: '#fceabb', navy: '#0f2540', white: '#ffffff',
  coral: '#f08b95', peach: '#f4b798', apricot: '#f7ca9d', violet: '#9180e8',
};
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const hex = (c) => '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
// A palette colour mixed toward white or navy in 10% steps.
const tint = (c, toward, steps) => {
  const a = rgb(c), b = rgb(toward === 'navy' ? P.navy : P.white), k = steps / 10;
  return hex(a.map((v, i) => v + (b[i] - v) * k));
};

// OKLab interpolation for the colour ramps along each ring (smooth, no muddy midpoints).
const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const unlin = (v) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
const toLab = (h) => {
  const [r, g, b] = rgb(h).map(lin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
};
const fromLab = ([L, A, B]) => {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return hex([4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s].map(unlin));
};
const ramp = (stops) => {
  const labs = stops.map(toLab);
  return (t) => {
    const x = Math.max(0, Math.min(1, t)) * (labs.length - 1);
    const i = Math.min(labs.length - 2, Math.floor(x)), u = x - i;
    return fromLab(labs[i].map((v, k) => v + (labs[i + 1][k] - v) * u));
  };
};

// ---- geometry helpers ----
const f = (n) => String(Math.round(n * 10) / 10);
const TAU = Math.PI * 2;
// Angle phi runs clockwise from 12 o'clock.
const pt = (r, phi) => [CX + r * Math.sin(phi), CY - r * Math.cos(phi)];
const P2 = (p) => `${f(p[0])} ${f(p[1])}`;
// A band of the annulus between angles a and b; cap0 / cap1 round off the start / end.
function band(r, w, a, b, cap0 = false, cap1 = false) {
  const R = r + w / 2, ri = r - w / 2, h = w / 2;
  const lg = b - a > Math.PI ? 1 : 0;
  let d = `M${P2(pt(R, a))}A${f(R)} ${f(R)} 0 ${lg} 1 ${P2(pt(R, b))}`;
  d += cap1 ? `A${f(h)} ${f(h)} 0 0 1 ${P2(pt(ri, b))}` : `L${P2(pt(ri, b))}`;
  d += `A${f(ri)} ${f(ri)} 0 ${lg} 0 ${P2(pt(ri, a))}`;
  d += cap0 ? `A${f(h)} ${f(h)} 0 0 1 ${P2(pt(R, a))}` : '';
  return d + 'Z';
}

// ---- the picture ----
// Three thick progress rings around one centre, each a lap begun at one shared start and running
// clockwise, each at a different completion. The middle ring has stopped part way; its whole lane is
// drawn pale beneath it, so the rest of its lap loops back round to its own start. done = the fraction
// of the lap drawn: art values, not data. Nothing marks a restart or a finish, so the picture takes no
// side. The shared start sits 40 degrees anticlockwise of 12 o'clock (about 10:40 on a clock face),
// off the 12 o'clock convention of fitness and progress-ring widgets, so it reads less like a UI gauge.
const LOOK = {
  bg: [[0, P.pink], [0.5, P.lilac], [1, P.violet]],  // vertical, top to bottom
  halo: [P.white, 0.25],                             // soft glow behind the rings
  ghost: [P.white, 0.5],                             // the stalled ring's pale lane
  start: -40,                                        // shared start, degrees clockwise from 12 o'clock
  outer: 462, w: 132, gap: 24,                       // outer ring centre-line radius, band width, gap
  rings: [                                           // outer to inner; ramp runs tail -> head
    { done: 0.82, ramp: ramp([P.cream, P.apricot, P.peach]) },
    { done: 0.40, ramp: ramp([tint(P.sky, 'white', 3), P.blue, tint(P.violet, 'navy', 5)]), stalled: true },
    { done: 0.62, ramp: ramp([P.pink, P.coral]) },
  ],
};
const RINGS = LOOK.rings.map((ring, k) => ({ ...ring, r: LOOK.outer - k * (LOOK.w + LOOK.gap), w: LOOK.w }));
const START = (LOOK.start / 360) * TAU;
const HALO_R = 620;
const SEG = (15 / 360) * TAU;   // a ring's colour ramp is laid down in short segments, each a linear gradient
const OVER = (0.8 / 360) * TAU; // each segment runs a little under the next, so no seam shows

const defs = [];
const body = [];
let gid = 0;

// Background: a soft vertical pastel gradient with a pale glow behind the rings.
const stops = (list) => list.map(([o, c, a]) => `<stop offset="${o}" stop-color="${c}"${a === undefined ? '' : ` stop-opacity="${a}"`}/>`).join('');
defs.push(`<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">${stops(LOOK.bg)}</linearGradient>`);
defs.push(`<radialGradient id="halo" cx="${CX}" cy="${CY}" r="${HALO_R}" gradientUnits="userSpaceOnUse">${stops([[0, LOOK.halo[0], LOOK.halo[1]], [1, LOOK.halo[0], 0]])}</radialGradient>`);
body.push(`<rect width="${W}" height="${H}" fill="url(#bg)"/>`);
body.push(`<circle cx="${CX}" cy="${CY}" r="${HALO_R}" fill="url(#halo)"/>`);

for (const ring of RINGS) {
  const end = ring.done * TAU;
  if (ring.stalled) {
    // Its whole lane, drawn pale under the arc: the rest of the lap loops back round to the start.
    body.push(`<circle cx="${CX}" cy="${CY}" r="${ring.r}" fill="none" stroke="${LOOK.ghost[0]}" stroke-width="${ring.w}" opacity="${LOOK.ghost[1]}"/>`);
  }
  const n = Math.max(1, Math.ceil(end / SEG));
  for (let i = 0; i < n; i++) {
    const a = START + (end * i) / n, b = START + (end * (i + 1)) / n;
    const last = i === n - 1;
    const id = `g${gid++}`;
    const pa = pt(ring.r, a), pb = pt(ring.r, b);
    defs.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${f(pa[0])}" y1="${f(pa[1])}" x2="${f(pb[0])}" y2="${f(pb[1])}"><stop offset="0" stop-color="${ring.ramp(i / n)}"/><stop offset="1" stop-color="${ring.ramp((i + 1) / n)}"/></linearGradient>`);
    body.push(`<path d="${band(ring.r, ring.w, a, last ? b : b + OVER, i === 0, last)}" fill="url(#${id})"/>`);
  }
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><defs>${defs.join('')}</defs>${body.join('')}</svg>\n`;

const here = dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] ?? resolve(here, '../../public/research/agent-reliability/cover-art.svg');
writeFileSync(out, svg);
console.log('wrote', out, svg.length, 'bytes');
