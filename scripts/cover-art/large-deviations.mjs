// Cover art for /research/large-deviations (VSL theme): "One tower". 1200 x 1600, full bleed.
// Run from the site root:  node scripts/cover-art/large-deviations.mjs [out.svg]
// Writes public/research/large-deviations/cover-art.svg by default. Node built-ins only. The only
// randomness is a PRNG seeded with a fixed constant, so two runs give byte-identical output.
//
// The picture: an axonometric field of white cube stacks on a regular grid, seen from above at a
// fixed angle. Almost every stack is one cube tall, a few are two, and one stack in the middle rises
// ten cubes high in the single accent colour (blue), its cubes deepening in tone as it climbs.
// Depth comes from one shared vertical gradient per face orientation (the far field hazes toward
// light gray, the near field darkens toward slate), so every face is a flat tone at any one height
// and the whole field reads as one smooth, calm surface.
//
// Public idea (from the project page): in JSQ(d) load balancing each arriving job joins the
// shortest of d sampled queues, so queues stay short; the rare event studied is some queue
// climbing to a high level inside a time window. Here a stack is a server's queue and a cube a
// job. The heights, the grid and the tower's height are art choices, not data or results; the
// level, the time window and how the project estimates the probability are not drawn.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---- canvas and camera ----
const W = 1200, H = 1600;
const STEP = 290;                     // screen length of one grid step before projection
const PHI = 56.8 * Math.PI / 180;     // camera elevation; chosen so the tower's top sits between
                                      // two field rows instead of grazing the cube behind it
const A = STEP * Math.SQRT1_2;        // screen x per grid step
const B = A * Math.sin(PHI);          // screen y per grid step
const C = STEP * Math.cos(PHI);       // screen y per unit of height
const F = 0.6;                        // cube edge, as a fraction of the grid step (the rest is floor)
const OX = 600, OY = 1375;            // screen position of the tower's cell centre, at floor level;
                                      // set so the top edge crops through cube bodies, not slivers
const TOWER_H = 10;                   // cubes in the tower
const P_TWO = 0.3;                    // chance a free cell is offered a second cube
const SEED = 26;                      // fixed PRNG seed (picked by eye for an even spread of 2s)

// ---- palette (VSL: grays and slate, one accent; tints mix with white or navy in 10% steps) ----
const NAVY = '#0f2540', WHITE = '#ffffff';
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (c, k) => { // k > 0: k x 10% toward white; k < 0: toward navy
  const a = hex(c), b = hex(k > 0 ? WHITE : NAVY), t = Math.abs(k) / 10;
  return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, '0')).join('');
};
const BLUE = '#5fa9d4';
// one vertical gradient per face orientation, far (top of canvas) -> near (bottom)
const GRAD = {
  floor: ['#b4bcc0', '#909aa0', '#54606c'],      // top stop one gray darker so the top edge holds on a light page
  t: ['#fcfcfc', mix('#d8d8d8', 5)],             // cube tops
  l0: [mix('#d8d8d8', 5), '#c0c4c8'],            // left faces, first cube of a stack
  r0: ['#d8d8d8', '#909aa0'],                    // right faces, first cube
  l1: [mix('#d8d8d8', 7), '#d8d8d8'],            // left faces, second cube (a step lighter)
  r1: [mix('#d8d8d8', 3), '#b4bcc0'],            // right faces, second cube
};
const FIELD = (k) => (k === 0 ? { l: 'url(#l0)', r: 'url(#r0)' } : { l: 'url(#l1)', r: 'url(#r1)' });
// the tower: pale where it leaves the field, deepening one 10% step per cube as it climbs
const TOWER = (k) => ({ l: mix(BLUE, 4 - k), r: mix(BLUE, 2 - k) });
const TOWER_TOP = mix(BLUE, 2);

// ---- geometry ----
const P = (x, y, z) => [OX + (x - y) * A, OY + (x + y) * B - z * C];
const n = (v) => String(Math.round(v));
const poly = (pts, fill) => `<path fill="${fill}" d="M${pts.map(([x, y]) => n(x) + ' ' + n(y)).join('L')}Z"/>`;

// One stack of h cubes on cell (u, v): a silhouette underlay in the first cube's right-face fill
// (so anti-aliased seams never show the floor), then each cube's two visible sides, then the top.
function stack(u, v, h, sides, topFill) {
  const d = F / 2, zt = h * F;
  const N = (z) => P(u - d, v - d, z), E = (z) => P(u + d, v - d, z);
  const S = (z) => P(u + d, v + d, z), Wc = (z) => P(u - d, v + d, z);
  let s = poly([N(zt), E(zt), E(0), S(0), Wc(0), Wc(zt)], sides(0).r);
  for (let k = 0; k < h; k++) {
    const c = sides(k), z0 = k * F, z1 = (k + 1) * F;
    s += poly([Wc(z1), S(z1), S(z0), Wc(z0)], c.l);
    s += poly([S(z1), E(z1), E(z0), S(z0)], c.r);
  }
  return s + poly([N(zt), E(zt), S(zt), Wc(zt)], topFill);
}

// ---- heights: 1 almost everywhere, 2 now and then, the tower once ----
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);
const key = (u, v) => u + ',' + v;
const height = new Map();
const cells = [];
for (let s = -30; s <= 30; s++) for (let u = -30; u <= 30; u++) cells.push({ u, v: s - u });
const capY = OY - TOWER_H * F * C;
for (const { u, v } of cells) {
  let h = 1;
  if (rand() < P_TWO) {
    let free = true;
    // never two raised stacks side by side (two in a column would read as a second tower)
    for (let du = -1; du <= 1; du++) for (let dv = -1; dv <= 1; dv++) if (height.get(key(u + du, v + dv)) === 2) free = false;
    // keep the tower's neighbours low and the space around its top clear
    if (Math.abs(u) <= 1 && Math.abs(v) <= 1) free = false;
    const [cx, cy] = P(u, v, 0);
    if (Math.abs(cx - OX) < 2 * F * A + 40 && cy - F * B - 2 * F * C < capY + 260 && cy + F * B > capY - 300) free = false;
    if (free) h = 2;
  }
  if (u === 0 && v === 0) h = TOWER_H;
  height.set(key(u, v), h);
}

// keep what reaches the canvas, and paint back to front
const stacks = [];
for (const { u, v } of cells) {
  const h = height.get(key(u, v));
  const [cx, cy] = P(u, v, 0);
  if (cx + F * A < 0 || cx - F * A > W || cy + F * B < 0 || cy - F * B - h * F * C > H) continue;
  stacks.push({ u, v, h });
}
stacks.sort((a, b) => (a.u + a.v) - (b.u + b.v) || a.u - b.u);

// ---- SVG ----
const lin = (id, stops) => `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="${H}">` +
  stops.map((c, i) => `<stop offset="${(i / (stops.length - 1)).toFixed(2)}" stop-color="${c}"/>`).join('') + '</linearGradient>';
const body = stacks.map(({ u, v, h }) => (u === 0 && v === 0
  ? stack(u, v, h, TOWER, TOWER_TOP)
  : stack(u, v, h, FIELD, 'url(#t)')));

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
<defs>${Object.entries(GRAD).map(([id, st]) => lin(id, st)).join('\n')}</defs>
<rect width="${W}" height="${H}" fill="url(#floor)"/>
${body.join('\n')}
</svg>
`;

const dest = process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), '../../public/research/large-deviations/cover-art.svg');
mkdirSync(dirname(dest), { recursive: true });
writeFileSync(dest, svg);
console.log('wrote', dest, svg.length, 'bytes');
