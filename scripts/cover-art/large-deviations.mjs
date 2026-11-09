// Cover artwork for /research/large-deviations (the "vsl" gray theme).
// Run from the site root:  node scripts/cover-art/large-deviations.mjs
// Writes public/research/large-deviations/cover-art.webp (1200 x 1600, opaque, WebP q84).
//
// What it shows: three supermarket checkouts on a soft gray studio floor, seen
// in a three-quarter view from 36 degrees above. Each checkout is a pale
// counter with a dark belt, a till and a small rectangular lane-light box on a
// pole; a few clay groceries sit on the belts. Lane 1 has one shopper at its
// till and lane 3 has two (one holds a basket). Lane 2's line starts at its
// till, runs out of its aisle, snakes across the floor in an S and leaves the
// picture at the bottom left; its lane light is the only one lit (cool blue).
// Faceless clay figures, 15 in all. A plain picture of a rare event in load
// balancing (arrivals pick the shortest of a few lines, yet one line grows very
// long). Only the everyday scene: no text, no numbers, nothing about the
// project's method or results.
//
// What math shapes it: none from queueing. The long line follows a centripetal
// Catmull-Rom spline through a few floor points (straight out of the aisle,
// then an S-curve), and the shoppers stand every `gap` units of arc length.
//
// How it is made: a small signed-distance-field ray marcher in plain JS.
// A shopper is a smooth union (polynomial smooth min) of two flat-soled leg
// cylinders, a rounded box that widens from hips to shoulders, two arm
// capsules, a neck and a round head, turned to face the front of its line.
// Counters, belts, tills, groceries, lane lights and the basket are rounded
// boxes, capped cylinders and a half torus; the floor is an analytic plane.
// Light, as in a clay studio render: a warm area key about 25 degrees across
// (each sub-sample of a pixel traces a cone-shaped SDF soft shadow, with inner
// and outer penumbra, toward a different point of the light), a cool
// shadowless fill from the right, a cool sky whose occlusion is traced in a
// wide cone upward, short-range SDF ambient occlusion for soft mid-gray contact
// shadows, a floor bounce, a cool rim light from behind and a soft sheen. The
// floor's colour is a faint cool vertical gradient with a soft pool of light
// behind the set; then an ACES-fit tone curve, a slightly cool white balance, a
// gentle vignette, a faint glow around the lit lane light and a +-0.5 LSB hash
// dither. 9 samples per pixel. Rows are shared out over worker threads; every
// pixel is a pure function of the scene, so the output does not depend on the
// thread count.
//
// Deterministic: the mulberry32 PRNG seeded with SEED = 1729 only jitters the
// shoppers (spacing, position, height, build and shade); the dither is a fixed
// hash of the pixel. Two runs give byte-identical files.
//
// Flags (for previews only; the default run writes the published file):
//   --out <file>   write somewhere else (.png or .webp)
//   --scale <s>    render at s x the size     --spp <1|4|9>   samples per pixel

import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, statSync } from 'node:fs';

const SEED = 1729;
const OUT = join(dirname(fileURLToPath(import.meta.url)), '../../public/research/large-deviations/cover-art.webp');

export const CFG = {
  W: 1200, H: 1600, spp: 9, quality: 84, seed: SEED,
  // orbit camera around `target`; `shift` moves the frame (lens shift, in half-frame units) without changing perspective
  camera: { target: [0.6, 0.6, 2.6], az: 18, el: 36, dist: 24, fov: 22, shift: [0.2, 0.06] },
  // lights: directions in degrees (az 0 = toward the camera side, +z; negative az = left)
  key: { az: -55, el: 50, width: 25, I: 1.9, col: [1.0, 0.91, 0.8] },    // warm area key
  fill: { az: 75, el: 20, I: 0.7, col: [0.74, 0.84, 1.0] },                  // cool, shadowless, from the right
  rim: { az: 200, el: 30, I: 0.42, col: [0.9, 0.95, 1.0] },                  // cool, from behind
  sky: { I: 0.85, col: [0.86, 0.91, 1.0], cone: 0.9, reach: 1.3 },  // cool sky; occlusion traced in a wide cone upward
  ao: { strength: 1.8, floor: 0.5, objFloor: 0.64 },  // gentle: contact shadows and crevices stay mid-gray
  exposure: 0.62,
  grade: [0.972, 0.987, 1.0],                 // a slightly cool white balance after the tone curve
  // three checkouts along x; each counter runs from z = 0 (entry, toward the camera) to z = -len (till end)
  lanes: { xs: [-2.1, 0, 2.1], len: 3.0, wid: 0.8, hgt: 0.92, aisle: 0.36 },
  // figures standing at lanes 1 and 3 (z positions); lane 2 is the long line
  short: [[-2.45], null, [-2.45, -1.45]],
  // the long line: spline through floor points (x offsets from lane 2's aisle, z), figures every `gap`
  long: { n: 12, gap: 1.08, pts: [[0, -2.45], [0, -0.4], [0.35, 1.5], [1.4, 2.9], [1.95, 4.2], [1.75, 5.7], [1.1, 6.9], [0.35, 8.0], [-0.4, 9.2], [-1.1, 10.4]] },
  figure: { height: 1.0, jitterH: 0.07, jitterW: 0.06, jitterPos: 0.05 },
  // sRGB colours: calm cool grays, slate, off-white and charcoal; one cool-blue accent (lane 2's light)
  col: {
    floorTop: '#dfe5ee', floorMid: '#dde3ec', floorBot: '#b9c2d0',
    counter: '#eef0f2', belt: '#525a66', till: '#6a7481', pole: '#717a86', housing: '#5d6672',
    panel: '#d9dde2', accent: '#7fa3d6', itemA: '#e9ecef', itemB: '#a7b1bd', basket: '#6c7787',
    tops: ['#8d98a8', '#a2acb8', '#7a8698', '#adb5c0', '#93a0b2', '#717d8f'],
    legs: ['#6a7483', '#747e8d', '#646e7d'],
  },
};

// ---------------------------------------------------------------- utilities
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const toLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lin = (h) => hex(h).map(toLin);
const toSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const D = Math.PI / 180;
const dirOf = (az, el) => [Math.cos(el * D) * Math.sin(az * D), Math.sin(el * D), Math.cos(el * D) * Math.cos(az * D)];
/** Triangular dither in (-1, 1) LSB from an integer hash of the pixel: deterministic, breaks up banding. */
function dither(x, y, c) {
  const h = (k) => { k = Math.imul(k ^ (k >>> 16), 0x7feb352d); k = Math.imul(k ^ (k >>> 15), 0x846ca68b); return ((k ^ (k >>> 16)) >>> 0) / 4294967296; };
  const k = (y * 4099 + x) * 3 + c + SEED;
  return (h(k) + h(k ^ 0x5bd1e995) - 1) * 0.5;
}

/** Camera basis and a world-to-image projection (image coords in 0..1). */
export function camera(cfg = CFG) {
  const cam = cfg.camera, [tx, ty, tz] = cam.target;
  const ca = Math.cos(cam.el * D);
  const c = [tx + cam.dist * Math.sin(cam.az * D) * ca, ty + cam.dist * Math.sin(cam.el * D), tz + cam.dist * Math.cos(cam.az * D) * ca];
  let f = [tx - c[0], ty - c[1], tz - c[2]]; { const l = Math.hypot(...f); f = f.map((v) => v / l); }
  let r = [-f[2], 0, f[0]]; { const l = Math.hypot(...r); r = r.map((v) => v / l); }   // right = f x up
  const u = [-r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1]];                     // up = right x f
  const th = Math.tan(cam.fov * D / 2), asp = cfg.W / cfg.H, [sx, sy] = cam.shift;
  const project = (x, y, z) => {
    const d = [x - c[0], y - c[1], z - c[2]], dd = d[0] * f[0] + d[1] * f[1] + d[2] * f[2];
    const pu = (d[0] * r[0] + d[2] * r[2]) / dd / th / asp - sx, pv = (d[0] * u[0] + d[1] * u[1] + d[2] * u[2]) / dd / th - sy;
    return [(pu + 1) / 2, (1 - pv) / 2];
  };
  return { c, f, r, u, th, asp, sx, sy, project };
}

// ---------------------------------------------------------------- scene
/** Centripetal Catmull-Rom through pts, sampled densely; returns [[x, z], ...]. */
function spline(pts, per = 200) {
  const P = [pts[0].map((v, i) => 2 * v - pts[1][i]), ...pts, pts.at(-1).map((v, i) => 2 * v - pts.at(-2)[i])];
  const out = [];
  for (let i = 1; i < P.length - 2; i++) {
    const [p0, p1, p2, p3] = [P[i - 1], P[i], P[i + 1], P[i + 2]];
    const tj = (a, b) => Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])) || 1e-6;
    const t0 = 0, t1 = t0 + tj(p0, p1), t2 = t1 + tj(p1, p2), t3 = t2 + tj(p2, p3);
    for (let k = 0; k < per; k++) {
      const t = t1 + (t2 - t1) * (k / per);
      const L = (a, b, ta, tb) => a.map((v, c) => ((tb - t) * v + (t - ta) * b[c]) / (tb - ta));
      const A1 = L(p0, p1, t0, t1), A2 = L(p1, p2, t1, t2), A3 = L(p2, p3, t2, t3);
      const B1 = L(A1, A2, t0, t2), B2 = L(A2, A3, t1, t3);
      out.push(L(B1, B2, t1, t2));
    }
  }
  out.push(pts.at(-1));
  return out;
}

/** Places the checkouts, groceries and shoppers. Pure function of cfg (and its seed). */
export function buildScene(cfg = CFG) {
  const rand = mulberry32(cfg.seed);
  const j = (a) => (rand() * 2 - 1) * a;
  const { xs, len, wid, hgt, aisle } = cfg.lanes;
  const boxes = [];   // [cx, cy, cz, hx, hy, hz, r, mat]
  const cyls = [];    // vertical capped cylinders [cx, y0, y1, cz, r, rounding, mat]
  const figs = [];    // [x, z, scale, widthScale, fx, fz, topIdx, legIdx, basket]
  let lit = null;     // centre of the lit panel (for the glow)
  xs.forEach((x, i) => {
    boxes.push([x, (hgt + 0.1) / 2, -len / 2, wid / 2, (hgt - 0.1) / 2, len / 2, 0.08, 1]);             // counter
    boxes.push([x, 0.07, -len / 2, wid / 2 - 0.06, 0.07, len / 2 - 0.06, 0.02, 4]);                     // recessed base
    boxes.push([x + 0.02, hgt + 0.012, -len * 0.38, wid / 2 - 0.1, 0.022, len * 0.3, 0.02, 2]);          // belt
    boxes.push([x + 0.1, hgt + 0.13, -len + 0.5, 0.2, 0.13, 0.2, 0.06, 3]);                             // till
    boxes.push([x - 0.02, hgt + 0.36, -len + 0.5, 0.05, 0.1, 0.16, 0.035, 3]);                          // till screen
    const px = x - 0.1, pz = -len + 0.14;
    cyls.push([px, hgt, 2.1, pz, 0.034, 0.01, 4]);                                                       // pole
    boxes.push([px, 2.3, pz, 0.33, 0.18, 0.07, 0.06, 5]);                                                // lane-light housing
    boxes.push([px, 2.3, pz, 0.27, 0.125, 0.077, 0.035, i === 1 ? 7 : 6]);                               // its face (lit on lane 2)
    if (i === 1) lit = [px, 2.3, pz + 0.08];
  });
  // groceries on the belts: a can and a box on lane 2, a box on lane 1
  const by = hgt + 0.034;
  cyls.push([xs[1] + 0.06, by, by + 0.24, -len * 0.58, 0.085, 0.03, 8]);
  boxes.push([xs[1] - 0.02, by + 0.13, -len * 0.42, 0.11, 0.13, 0.08, 0.03, 9]);
  boxes.push([xs[0] + 0.02, by + 0.09, -len * 0.52, 0.13, 0.09, 0.1, 0.03, 8]);

  const aisleX = (i) => xs[i] + wid / 2 + aisle;
  const person = (x, z, fx, fz, extra = 0) => {
    const l = Math.hypot(fx, fz);
    figs.push([x + j(cfg.figure.jitterPos), z + j(cfg.figure.jitterPos), cfg.figure.height * (1 + j(cfg.figure.jitterH)), 1 + j(cfg.figure.jitterW),
      fx / l, fz / l, Math.floor(rand() * cfg.col.tops.length), Math.floor(rand() * cfg.col.legs.length), extra]);
  };
  cfg.short.forEach((q, i) => {
    if (!q) return;
    q.forEach((z, k) => person(aisleX(i), z, 0, -1, i === 2 && k === 1 ? 1 : 0));
  });
  // the long line: from lane 2's till, straight out of its aisle, then an S-curve toward the viewer
  const ax = aisleX(1);
  const path = spline(cfg.long.pts.map(([dx, z]) => [ax + dx, z]));
  let acc = 0, next = 0;
  for (let i = 1, k = 0; i < path.length && k < cfg.long.n; i++) {
    const [x0, z0] = path[i - 1], [x1, z1] = path[i];
    const seg = Math.hypot(x1 - x0, z1 - z0);
    if (acc + seg >= next) {
      const t = (next - acc) / seg, x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
      person(x, z, x0 - x1, z0 - z1);   // faces the front of the line
      k++; next += cfg.long.gap * (1 + j(0.06));
    }
    acc += seg;
  }
  return { boxes, cyls, figs, lit };
}

// ---------------------------------------------------------------- renderer (worker)
function renderRows(cfg, scene, W, H, spp, rows, out) {
  const { boxes, cyls, figs } = scene;
  const nb = boxes.length, nc = cyls.length, nf = figs.length;
  const B = Float64Array.from(boxes.flat()), C = Float64Array.from(cyls.flat()), G = Float64Array.from(figs.flat());
  const FS = 9;   // floats per figure
  const TOP = 2.5;
  // bounding box of everything (for marching)
  let bx0 = 1e9, bx1 = -1e9, bz0 = 1e9, bz1 = -1e9;
  for (let i = 0; i < nb; i++) { bx0 = Math.min(bx0, B[i * 8] - B[i * 8 + 3] - 0.1); bx1 = Math.max(bx1, B[i * 8] + B[i * 8 + 3] + 0.1); bz0 = Math.min(bz0, B[i * 8 + 2] - B[i * 8 + 5] - 0.1); bz1 = Math.max(bz1, B[i * 8 + 2] + B[i * 8 + 5] + 0.1); }
  for (let i = 0; i < nf; i++) { bx0 = Math.min(bx0, G[i * FS] - 0.7); bx1 = Math.max(bx1, G[i * FS] + 0.7); bz0 = Math.min(bz0, G[i * FS + 1] - 0.7); bz1 = Math.max(bz1, G[i * FS + 1] + 0.7); }

  const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
  const capV = (x, y, z, y0, y1, r) => { const cy = y < y0 ? y0 : y > y1 ? y1 : y; const dy = y - cy; return Math.sqrt(x * x + dy * dy + z * z) - r; };
  const rbox = (qx, qy, qz, hx, hy, hz, r) => {
    const ax = Math.abs(qx) - hx + r, ay = Math.abs(qy) - hy + r, az = Math.abs(qz) - hz + r;
    const mx = ax > 0 ? ax : 0, my = ay > 0 ? ay : 0, mz = az > 0 ? az : 0;
    return Math.sqrt(mx * mx + my * my + mz * mz) + Math.min(Math.max(ax, ay, az), 0) - r;
  };

  let MAT = 0, FIG = 0, LEGW = 0;
  // A shopper in local coordinates (lx: sideways, ly: up, lz: forward), about 1.44 tall at scale 1.
  function personSD(lx, ly, lz, want) {
    const ax = Math.abs(lx);
    // legs: two rounded cylinders (flat-soled, so they stand on the floor) with a small gap between them
    let dLeg;
    {
      const qx = ax - 0.08, rr = 0.035;
      const dx = Math.sqrt(qx * qx + lz * lz) - 0.07 + rr, dy = Math.abs(ly - 0.31) - 0.31 + rr;
      dLeg = Math.min(Math.max(dx, dy), 0) + Math.sqrt(Math.max(dx, 0) ** 2 + Math.max(dy, 0) ** 2) - rr;
    }
    // torso: a rounded box that widens from hips to shoulders
    const t = Math.min(1, Math.max(0, (ly - 0.58) / 0.56));
    const dTor = rbox(lx, ly - 0.87, lz, 0.145 + 0.06 * t, 0.29, 0.118, 0.105);
    // arms hanging at the sides (capsule from shoulder to hand)
    let dArm;
    {
      const ax0 = 0.207, ay0 = 1.05, ax1 = 0.232, ay1 = 0.64, az1 = 0.02;
      const bx = ax1 - ax0, by = ay1 - ay0, bz = az1, px = ax - ax0, py = ly - ay0, pz = lz;
      const h = Math.min(1, Math.max(0, (px * bx + py * by + pz * bz) / (bx * bx + by * by + bz * bz)));
      const dx = px - bx * h, dy = py - by * h, dz = pz - bz * h;
      dArm = Math.sqrt(dx * dx + dy * dy + dz * dz) - 0.057;
    }
    const dNeck = capV(lx, ly, lz, 1.12, 1.22, 0.05);
    const hy = ly - 1.325, dHead = Math.sqrt(lx * lx + hy * hy * 0.92 + (lz - 0.005) * (lz - 0.005)) - 0.118;
    let up = smin(dTor, dArm, 0.03);
    up = smin(up, dNeck, 0.04);
    up = smin(up, dHead, 0.035);
    const d = smin(up, dLeg, 0.05);
    if (want) LEGW = Math.min(1, Math.max(0, 0.5 + (up - dLeg) / 0.05)) * (ly < 0.66 ? 1 : 0);
    return d;
  }
  // a shopping basket held in the right hand (local coords of the shopper)
  function basketSD(lx, ly, lz) {
    const cx = lx - 0.3, cy = ly - 0.34;
    const outer = rbox(cx, cy, lz, 0.11, 0.11, 0.19, 0.03);
    const inner = rbox(cx, cy - 0.035, lz, 0.086, 0.11, 0.166, 0.022);
    let d = Math.max(outer, -inner);
    // handle: a half torus over the long axis, held at the top
    const hy = ly - 0.45, q = Math.sqrt(hy * hy + lz * lz) - 0.16, dh = Math.max(Math.sqrt(q * q + (lx - 0.28) * (lx - 0.28)) - 0.018, -hy);
    return Math.min(d, dh);
  }

  function map(px, py, pz, want) {
    let d = 1e9;
    for (let i = 0; i < nf; i++) {
      const o = i * FS, dx = px - G[o], dz = pz - G[o + 1], s = G[o + 2];
      const rough = Math.max(Math.sqrt(dx * dx + dz * dz) - 0.5 * s, py - 1.5 * s);
      if (rough > d) continue;
      const w = G[o + 3], fx = G[o + 4], fz = G[o + 5];
      const lx = (dx * -fz + dz * fx) / (s * w), lz = (dx * fx + dz * fz) / s, ly = py / s;
      let v = personSD(lx, ly, lz, want) * s * Math.min(1, w);
      let isB = false;
      if (G[o + 8] > 0) { const vb = basketSD(lx, ly, lz) * s * Math.min(1, w); if (vb < v) { v = vb; isB = true; } }
      if (v < d) { d = v; if (want) { MAT = isB ? 12 : 10; FIG = i; } }
    }
    for (let i = 0; i < nb; i++) {
      const o = i * 8;
      const v = rbox(px - B[o], py - B[o + 1], pz - B[o + 2], B[o + 3], B[o + 4], B[o + 5], B[o + 6]);
      if (v < d) { d = v; if (want) MAT = B[o + 7]; }
    }
    for (let i = 0; i < nc; i++) {
      const o = i * 7, dx = px - C[o], dz = pz - C[o + 3], rd = C[o + 5];
      const rr = Math.sqrt(dx * dx + dz * dz) - C[o + 4] + rd;
      const hh = Math.abs(py - (C[o + 1] + C[o + 2]) / 2) - (C[o + 2] - C[o + 1]) / 2 + rd;
      const v = Math.min(Math.max(rr, hh), 0) + Math.sqrt(Math.max(rr, 0) ** 2 + Math.max(hh, 0) ** 2) - rd;
      if (v < d) { d = v; if (want) MAT = C[o + 6]; }
    }
    return d;
  }

  const cam = camera(cfg);
  const [cx, cy, cz] = cam.c, [fx, fy, fz] = cam.f, [rx, , rz] = cam.r, [ux, uy, uz] = cam.u;
  const th = cam.th, asp = W / H;
  // key light: each sub-sample of a pixel sees the light from a different point of its disc (Vogel spiral);
  // each of those shadow rays is a cone of the light's remaining width
  const l0 = dirOf(cfg.key.az, cfg.key.el);
  const e1 = [l0[2], 0, -l0[0]].map((v, _, a) => v / Math.hypot(...a));
  const e2 = [l0[1] * e1[2] - l0[2] * e1[1], l0[2] * e1[0] - l0[0] * e1[2], l0[0] * e1[1] - l0[1] * e1[0]];
  const tanR = Math.tan(cfg.key.width / 2 * D);   // angular radius = half the width
  const offs = spp === 1 ? [[0, 0]] : spp === 4 ? [[-0.125, -0.375], [0.375, -0.125], [0.125, 0.375], [-0.375, 0.125]]
    : [-1, 0, 1].flatMap((a) => [-1, 0, 1].map((b) => [a / 3, b / 3]));
  const nS = offs.length;
  const LDIRS = Array.from({ length: nS }, (_, i) => {
    const r = nS === 1 ? 0 : Math.sqrt((i + 0.5) / nS) * tanR * 0.55, a = i * 2.399963229728653;
    const v = [0, 1, 2].map((c) => l0[c] + r * (Math.cos(a) * e1[c] + Math.sin(a) * e2[c]));
    const l = Math.hypot(...v); return v.map((c) => c / l);
  });
  const coneW = tanR * 0.75;
  let lx = l0[0], ly = l0[1], lz = l0[2];
  const fd = dirOf(cfg.fill.az, cfg.fill.el), rd_ = dirOf(cfg.rim.az, cfg.rim.el);
  const col = {};
  for (const [k, v] of Object.entries(cfg.col)) col[k] = Array.isArray(v) ? v.map(lin) : lin(v);
  const albedo = [null, col.counter, col.belt, col.till, col.pole, col.housing, col.panel, col.accent, col.itemA, col.itemB];

  function softShadow(px, py, pz) {
    // cone-traced soft shadow with inner and outer penumbra (res may go negative inside the cone)
    let res = 1, t = 0.05;
    for (let i = 0; i < 120; i++) {
      const y = py + ly * t;
      if (y > TOP) break;
      const h = map(px + lx * t, y, pz + lz * t, false);
      res = Math.min(res, h / (coneW * t));
      if (res < -1) break;
      t += Math.min(Math.max(h, 0.012), 0.2);
    }
    res = Math.max(res, -1);
    return 0.25 * (1 + res) * (1 + res) * (2 - res);
  }
  // how much of the sky a point sees: a wide cone traced straight up (soft contact pools under things)
  const skyW = cfg.sky.cone, skyR = cfg.sky.reach;
  function skyVis(px, py, pz) {
    let res = 1, t = 0.04;
    for (let i = 0; i < 40 && t < skyR; i++) {
      const y = py + t;
      if (y > TOP) break;
      const h = map(px, y, pz, false);
      res = Math.min(res, h / (skyW * t));
      if (res < -1) break;
      t += Math.min(Math.max(h, 0.03), 0.25);
    }
    res = Math.max(res, -1);
    return 0.25 * (1 + res) * (1 + res) * (2 - res);
  }
  function ao(px, py, pz, nx, ny, nz, lo) {
    let occ = 0, sca = 1;
    for (let i = 1; i <= 5; i++) {
      const h = 0.025 * i * i;             // 0.025 .. 0.625: dense near the surface for soft contact shadows
      const qx = px + nx * h, qy = py + ny * h, qz = pz + nz * h;
      const d = Math.min(map(qx, qy, qz, false), qy + 0.001);
      occ += (h - d) * sca; sca *= 0.75;
    }
    const a = Math.max(0, Math.min(1, 1 - cfg.ao.strength * occ));
    return lo + (1 - lo) * a;
  }

  const KC = cfg.key.col, KI = cfg.key.I, FC = cfg.fill.col, FI = cfg.fill.I, RC = cfg.rim.col, RI = cfg.rim.I, SC = cfg.sky.col, SI = cfg.sky.I;
  const out3 = [0, 0, 0];
  const gradTop = col.floorTop, gradMid = col.floorMid, gradBot = col.floorBot;
  function shade(ox, oy, oz, dx, dy, dz, sx, sy) {
    let tmin = 0, tmax = 1e9;
    {
      const inv = [1 / dx, 1 / dy, 1 / dz], lo = [bx0, 0, bz0], hi = [bx1, TOP, bz1], o = [ox, oy, oz];
      for (let a = 0; a < 3; a++) { let t0 = (lo[a] - o[a]) * inv[a], t1 = (hi[a] - o[a]) * inv[a]; if (t0 > t1) [t0, t1] = [t1, t0]; tmin = Math.max(tmin, t0); tmax = Math.min(tmax, t1); }
    }
    let hit = false, t = tmin;
    if (tmin < tmax) {
      for (let i = 0; i < 200 && t < tmax; i++) {
        const h = map(ox + dx * t, oy + dy * t, oz + dz * t, false);
        if (h < 0.0006 * t) { hit = true; break; }
        t += h * 0.9;
      }
    }
    const tFloor = -oy / dy;
    let px, py, pz, nx, ny, nz, alb, mat = 0;
    if (hit && t < tFloor) {
      px = ox + dx * t; py = oy + dy * t; pz = oz + dz * t;
      map(px, py, pz, true); mat = MAT;
      const e = 0.0012;
      const a = map(px + e, py - e, pz - e, false), b = map(px - e, py - e, pz + e, false), c = map(px - e, py + e, pz - e, false), d4 = map(px + e, py + e, pz + e, false);
      nx = a - b - c + d4; ny = -a - b + c + d4; nz = -a + b - c + d4;
      const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
      if (mat === 10) {
        const o = FIG * FS, top = col.tops[G[o + 6]], leg = col.legs[G[o + 7]];
        alb = [0, 1, 2].map((i) => top[i] * (1 - LEGW) + leg[i] * LEGW);
      } else if (mat === 12) alb = col.basket;
      else alb = albedo[mat];
      // the lane light's face glows only on its front and back
      if ((mat === 6 || mat === 7) && Math.abs(nz) < 0.8) { mat = 5; alb = albedo[5]; }
    } else {
      px = ox + dx * tFloor; py = 0; pz = oz + dz * tFloor; nx = 0; ny = 1; nz = 0;
      // a faint cool vertical gradient in the frame (cooler, a little darker at the top) ...
      const v = sy;
      const wT = Math.max(0, 1 - v / 0.55), wB = Math.max(0, (v - 0.55) / 0.45);
      const s1 = wT * wT * (3 - 2 * wT), s2 = wB * wB * (3 - 2 * wB);
      alb = [0, 1, 2].map((i) => gradMid[i] + (gradTop[i] - gradMid[i]) * s1 + (gradBot[i] - gradMid[i]) * s2);
      // ... and a soft pool of light behind the set, falling off toward the edges of the frame
      const qx = (sx - 0.5) / 0.72, qy = (sy - 0.42) / 0.78, f = Math.min(1, Math.max(0, (Math.sqrt(qx * qx + qy * qy) - 0.25) / 0.85));
      const pool = 1.05 - 0.19 * f * f * (3 - 2 * f);
      alb = alb.map((c) => c * pool);
    }
    const sh = softShadow(px + nx * 0.015, py + ny * 0.015, pz + nz * 0.015);
    const vis = skyVis(px + nx * 0.01, py + ny * 0.01, pz + nz * 0.01);
    const occ = ao(px, py, pz, nx, ny, nz, mat ? cfg.ao.objFloor : cfg.ao.floor) * (mat ? 0.62 + 0.38 * vis : 0.45 + 0.55 * vis);
    const ndl = nx * lx + ny * ly + nz * lz;
    // wrapped diffuse for the key: a soft clay terminator
    const dif = mat ? Math.max(0, (ndl + 0.3) / 1.3) : Math.max(0, ndl);
    const fdl = Math.max(0, (nx * fd[0] + ny * fd[1] + nz * fd[2] + 0.35) / 1.35);
    const hemi = 0.6 + 0.4 * ny;
    const bnc = Math.max(0, -ny) * 0.6 + Math.max(0, 1 - ny) * 0.2;
    let hx = lx - dx, hy = ly - dy, hz = lz - dz; const hl = Math.hypot(hx, hy, hz); hx /= hl; hy /= hl; hz /= hl;
    const spec = mat ? Math.pow(Math.max(0, nx * hx + ny * hy + nz * hz), 14) * 0.12 * sh : 0;
    const ndv = Math.max(0, -(nx * dx + ny * dy + nz * dz));
    const rim = mat ? Math.pow(1 - ndv, 2.5) * Math.max(0, nx * rd_[0] + ny * rd_[1] + nz * rd_[2] + 0.25) * RI * occ : 0;
    for (let i = 0; i < 3; i++) {
      let v = alb[i] * (KC[i] * KI * dif * sh + FC[i] * FI * fdl * (mat ? 1 : 0) * (0.5 + 0.5 * occ) + SC[i] * SI * hemi * occ + (mat ? 0.5 : 0.22) * col.floorMid[i] * bnc * (0.5 + 0.5 * occ))
        + spec * KC[i] + rim * RC[i];
      if (mat === 7) v = alb[i] * (0.9 + 0.2 * Math.abs(nz));      // the lit lane light
      out3[i] = v;
    }
    return out3;
  }

  // glow around the lit lane light (screen space)
  const glowP = scene.lit ? cam.project(...scene.lit) : null;
  const exposure = cfg.exposure;
  for (const y of rows) {
    for (let x = 0; x < W; x++) {
      let r = 0, g = 0, b = 0;
      for (let si = 0; si < nS; si++) {
        const [ox_, oy_] = offs[si];
        [lx, ly, lz] = LDIRS[si];
        const u = (((x + 0.5 + ox_) / W) * 2 - 1 + cam.sx) * th * asp, v = (1 - ((y + 0.5 + oy_) / H) * 2 + cam.sy) * th;
        let dx = fx + u * rx + v * ux, dy = fy + v * uy, dz = fz + u * rz + v * uz;
        const l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
        const c = shade(cx, cy, cz, dx, dy, dz, (x + 0.5) / W, (y + 0.5) / H);
        r += c[0]; g += c[1]; b += c[2];
      }
      const o = (y * W + x) * 4;
      const rgb = [r / nS, g / nS, b / nS];
      if (glowP) {
        const gx = (x / W - glowP[0]) * asp, gy = y / H - glowP[1], g2 = (gx * gx + gy * gy) / (0.045 * 0.045);
        const gw = 0.45 * Math.exp(-g2);
        for (let i = 0; i < 3; i++) rgb[i] += gw * col.accent[i];
      }
      const vx = (x / W - 0.5) * 1.5, vy = (y / H - 0.5) * 1.2, vig = 1 - 0.2 * Math.min(1, vx * vx + vy * vy);
      for (let i = 0; i < 3; i++) {
        let c = rgb[i] * exposure * vig;
        c = (c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14) * cfg.grade[i]; // ACES fit, then the grade
        out[o + i] = Math.round(255 * toSrgb(Math.max(0, Math.min(1, c))) + dither(x, y, i));
      }
      out[o + 3] = 255;
    }
  }
}

// ---------------------------------------------------------------- main
function args() {
  const a = process.argv.slice(2), get = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
  return { out: get('--out') ?? OUT, scale: +(get('--scale') ?? 1), spp: get('--spp') ? +get('--spp') : undefined };
}

if (!isMainThread) {
  const { cfg, scene, W, H, spp, rows, sab } = workerData;
  renderRows(cfg, scene, W, H, spp, rows, new Uint8ClampedArray(sab));
  parentPort.postMessage('done');
} else if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { default: sharp } = await import('sharp');
  const opt = args();
  const W = Math.round(CFG.W * opt.scale), H = Math.round(CFG.H * opt.scale), spp = opt.spp ?? CFG.spp;
  const scene = buildScene(CFG);
  const sab = new SharedArrayBuffer(W * H * 4);
  const nW = Math.max(1, Math.min(availableParallelism(), 14));
  const t0 = Date.now();
  await Promise.all(Array.from({ length: nW }, (_, k) => new Promise((res, rej) => {
    const rows = [];
    for (let y = k; y < H; y += nW) rows.push(y);
    const w = new Worker(new URL(import.meta.url), { workerData: { cfg: CFG, scene, W, H, spp, rows, sab } });
    w.on('message', res); w.on('error', rej);
  })));
  const img = sharp(Buffer.from(sab), { raw: { width: W, height: H, channels: 4 } }).removeAlpha();
  mkdirSync(dirname(opt.out), { recursive: true });
  if (opt.out.endsWith('.png')) await img.png().toFile(opt.out);
  else await img.webp({ quality: CFG.quality, effort: 6, smartSubsample: true }).toFile(opt.out);
  console.log(`wrote ${opt.out} ${W}x${H} spp=${spp} in ${((Date.now() - t0) / 1000).toFixed(1)} s, ${(statSync(opt.out).size / 1024).toFixed(1)} KB`);
}
