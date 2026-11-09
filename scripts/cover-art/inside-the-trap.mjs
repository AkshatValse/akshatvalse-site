// Cover artwork for /research/inside-the-trap (the "kaleido" colour theme).
// Run from the site root:  node scripts/cover-art/inside-the-trap.mjs [out.webp]
// Writes public/research/inside-the-trap/cover-art.webp (1200 x 1600) by default.
//
// What it shows: a small clay diorama of a landscape floating in a pastel sky
// (two soft clouds above it). Its top has two smooth valleys separated by a
// rounded crest: a shallow bowl on the left and a deep, wide one on the right.
// A glossy navy marble rests at the bottom of the deep valley. A faint ghost of
// the marble sits in the shallow bowl where it started, and a dotted navy trail
// runs from it up over the crest and down to the marble. The cut faces show the
// land's cross-section in soft pastel layers.
// Layman reading: a system that tipped into a bad state and stays stuck there,
// even though a better state exists next door.
//
// Math: the cross-section is the textbook tilted double-well potential
//   V(u) = (u^2 - 1)^2 - t u,   t = 0.3 (t > 0 makes the right well deeper;
// at t = 0.3 the left well is about 0.54 times as deep as the right one,
// measured from the crest). Two cosmetic changes: past |u| ~ 1.1 the outer
// walls are stretched sideways by a softplus warp, so the deep well is a
// rounded bowl rather than a slot, and they are capped into rims by a
// polynomial smooth minimum with a domed parabola (see profile()). It is a
// metaphor only: no data or result from the paper is drawn.
//
// How: a small sphere-tracing renderer in plain JS (signed distance fields,
// soft shadows, ambient occlusion, a Fresnel reflection on the marble), with
// ss x ss supersampling per pixel, split by rows over worker threads (each
// pixel is a pure function of its coordinates, so the output does not depend
// on the number of threads). Encoded to WebP with sharp. About 5 s on 16 cores.
//
// Deterministic: the only randomness is a +-0.5 LSB dither before 8-bit
// quantisation (against banding in the gradients), drawn from mulberry32
// seeded with SEED = 0x7a11c0de. COVER_SS=1 in the environment gives a quick
// preview; leave it unset for the published file.

import sharp from 'sharp';
import os from 'node:os';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

const SEED = 0x7a11c0de;
const DEFAULT_OUT = join(dirname(fileURLToPath(import.meta.url)), '../../public/research/inside-the-trap/cover-art.webp');

export const CFG = {
  W: 1200, H: 1600,
  ss: +(process.env.COVER_SS || 3), // supersampling grid per pixel (ss x ss); 3 for the published file
  quality: 84,                 // WebP quality
  // Terrain: x in [-XH, XH], z in [-ZH, ZH]; top surface y = BASE + K * smin(V(warp(u)), rim cap), u = x / S.
  XH: 1.95, ZH: 1.8, RC: 0.36,   // half-sizes and corner radius of the slab footprint
  BEVEL: 0.07,                 // rounding where the top meets the sides
  S: 1.1, T: 0.3, K: 0.55, BASE: 0.55, // u = x / S; tilt t; vertical scale; slab thickness under the profile
  OW: 0.75, U0: 1.12, OK: 0.12, // outer walls stretched sideways past |u| ~ U0 (slope factor OW, softness OK)
  RIM: [1.75, 0.16, 0.28], RIMK: 0.45, RIMW: 0.14, // rims: smooth min of V with A + B u - Q u^2 + RIMW wobble(z)
  MEANDER: 0.10,               // gentle sideways wander of the valleys along z
  SADDLE: 0.04, SADDLEZ: -0.12, // a slight dip in the crest where the trail crosses
  // Marble (in the deep well) and its faint ghost (where it started, in the shallow well)
  R: 0.27, MZ: 0.22, GZ: -0.55, GHOST: 0.25, // radius, z positions (x is each well's minimum), ghost opacity
  // Camera (degrees, world units)
  target: [-0.15, 0.48, 0.0], dist: 15.7, elev: 40, azim: 15, fovY: 25.6,
  shiftY: 0.25,                // vertical lens shift (fraction of half-height), moves the scene down
  // Lighting
  light: [-0.72, 0.62, 0.30],  // direction toward the key light (upper left, slightly in front)
  fillLight: [0.75, 0.35, 0.55], fill: 0.28, // a cool, shadowless fill from the right
  floorLight: [0.10, 1, -0.12], // a steeper light used only for the floor shadow, so it pools under the slab
  marbleLight: [-0.12, 1.0, 0.30], // a near-overhead light used only for the marble's cast shadow, so it pools
                               // under the marble on the valley floor instead of climbing the right wall
  shadowK: 9,                  // soft-shadow sharpness (lower = softer)
  marbleShadowK: 4,            // the marble's own cast shadow is softer
  floorY: -0.42,
  // Palette (sRGB hex); no greens.
  land: [                      // albedo of the land on top, by world height y
    [0.30, '#c4c6f2'],
    [0.52, '#e2c3f1'],
    [0.74, '#f6c2da'],
    [0.95, '#f9cad8'],
    [1.16, '#fde3d8'],
  ],
  strata: [                    // albedo of the cut faces, by depth below the surface (0 top, 1 base)
    [0.00, '#f6c9da'],
    [0.10, '#e6c6f2'],
    [0.38, '#a8d2ea'],
    [0.72, '#6ea7d6'],
    [1.00, '#3d6aa3'],
  ],
  backdrop: [[0, '#9fcfea'], [0.40, '#d6e3f6'], [0.70, '#f1dcec'], [1, '#fde8da']], // sky blue above, blush and cream below
  // Two small clouds in the sky, for scale and air: [image x, image y, distance from camera, size].
  clouds: [[255, 300, 21, 0.265], [985, 450, 19, 0.175]],
  haze: 0.30,                  // how much the clouds fade into the sky behind them
  cloud: '#f8f0f6',
  marble: '#0f2540',
  trail: '#0f2540', TRAIL_A: [0.55, 0.68], // navy dots, opacity ramping from the ghost to the marble
  TRAIL_R: 0.063, TRAIL_STEP: 0.185, // trail dot radius and spacing (world units)
  CREST_W: 0.10, CREST_A: 0.22, // a lighter band along the crest between the wells: half-width, strength
};

// ---------------------------------------------------------------- helpers
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const s2l = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const l2s = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const hexLin = (h) => [1, 3, 5].map((i) => s2l(parseInt(h.slice(i, i + 2), 16) / 255));
const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** mulberry32: small seeded PRNG, uniform on [0, 1). */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Piecewise-linear lookup in a list of [position, linear rgb] stops; writes into out. */
function rampAt(stops, x, out) {
  if (x <= stops[0][0]) { out[0] = stops[0][1][0]; out[1] = stops[0][1][1]; out[2] = stops[0][1][2]; return out; }
  for (let i = 1; i < stops.length; i++) {
    if (x <= stops[i][0]) {
      const [x0, c0] = stops[i - 1], [x1, c1] = stops[i];
      let t = (x - x0) / (x1 - x0); t = t * t * (3 - 2 * t);
      out[0] = c0[0] + (c1[0] - c0[0]) * t; out[1] = c0[1] + (c1[1] - c0[1]) * t; out[2] = c0[2] + (c1[2] - c0[2]) * t;
      return out;
    }
  }
  const c = stops[stops.length - 1][1]; out[0] = c[0]; out[1] = c[1]; out[2] = c[2]; return out;
}

// ---------------------------------------------------------------- scene
const C = CFG;
const CREST_U = (() => { let u = -C.T / 4; for (let i = 0; i < 30; i++) u -= (4 * u * u * u - 4 * u - C.T) / (12 * u * u - 4); return u; })();
const LAND = C.land.map(([p, h]) => [p, hexLin(h)]);
const STRATA = C.strata.map(([p, h]) => [p, hexLin(h)]);
const BACK = C.backdrop.map(([p, h]) => [p, hexLin(h)]);
const MARBLE = hexLin(C.marble);
const TRAIL_S = hexLin(C.trail).map(l2s);
const L = norm(C.light);
const FL = norm(C.floorLight);
const ML = norm(C.marbleLight);
const LF = norm(C.fillLight);
const KEY = [1.0, 0.95, 0.9];      // warm key light
const SKY = [0.74, 0.78, 1.0];     // cool lilac-blue fill from above
const FILL = [0.62, 0.70, 1.0];    // cool fill light from the right (no shadows)
const BOUNCE = [1.0, 0.86, 0.86];  // pink bounce from below
const SHADOW_TINT = [0.42, 0.34, 0.62]; // floor shadows lean lilac-navy, not gray

/** Tilted double well with rims at both ends: the terrain height above BASE at x (with a meander along z). */
function profile(x, z) {
  const xm = x - C.MEANDER * Math.sin(1.25 * z + 0.6);
  let u = xm / C.S;
  // Past |u| ~ U0 the quartic's outer walls are stretched sideways (a softplus warp), so the
  // deep well is a rounded bowl with room around the marble rather than a slot.
  const sp = C.OK * Math.log1p(Math.exp((Math.abs(u) - C.U0) / C.OK));
  u -= (1 - C.OW) * Math.sign(u) * sp;
  const u2 = u * u;
  const V = (u2 - 1) * (u2 - 1) - C.T * u;
  // Rims: a smooth minimum with a gently domed cap, higher on the right, rolling a little along z.
  const sR = smooth(-0.6, 0.6, u), wob = Math.sin(2.2 * z - 2.39) * (1 - sR) + Math.sin(1.2 * z + 0.37) * sR;
  const cap = C.RIM[0] + C.RIM[1] * u - C.RIM[2] * u2 + C.RIMW * wob;
  return C.K * smin(V, cap, C.RIMK);
}
/** Top surface: the profile, a little deeper toward the back, with a low saddle in the crest where the trail crosses. */
function topY(x, z) {
  const u = (x - C.MEANDER * Math.sin(1.25 * z + 0.6)) / C.S - CREST_U;
  const saddle = C.SADDLE * Math.exp(-(u * u) / 0.15 - ((z - C.SADDLEZ) ** 2) / 0.5);
  return C.BASE + profile(x, z) * (1 + 0.05 * Math.sin(1.4 * z + 0.4)) - saddle;
}

function smax(a, b, k) {
  const h = clamp(0.5 + 0.5 * (a - b) / k, 0, 1);
  return b + (a - b) * h + k * h * (1 - h);
}

// Lipschitz factor for the height-field distance: 1 / sqrt(1 + max slope^2), measured on a grid, with a margin.
const LIP = (() => {
  let g = 0; const e = 1e-3;
  for (let x = -C.XH; x <= C.XH; x += 0.01) for (let z = -C.ZH; z <= C.ZH; z += 0.02) {
    const gx = (topY(x + e, z) - topY(x - e, z)) / (2 * e), gz = (topY(x, z + e) - topY(x, z - e)) / (2 * e);
    g = Math.max(g, Math.hypot(gx, gz));
  }
  return 0.9 / Math.sqrt(1 + g * g);
})();
function sdSlab(x, y, z) {
  const dTop = (y - topY(x, z)) * LIP;
  const qx = Math.abs(x) - (C.XH - C.RC), qz = Math.abs(z) - (C.ZH - C.RC);
  const ox = qx > 0 ? qx : 0, oz = qz > 0 ? qz : 0;
  const dRect = Math.sqrt(ox * ox + oz * oz) + Math.min(Math.max(qx, qz), 0) - C.RC;
  return smax(smax(dTop, dRect, C.BEVEL), -y, 0.04);
}

/** x of the lowest point of the surface along the line z = const, for x in [x0, x1]. */
function wellBottom(x0, x1, z) { let best = 0, bv = Infinity; for (let x = x0; x < x1; x += 1e-4) { const v = topY(x, z); if (v < bv) { bv = v; best = x; } } return best; }
// Marble: at the bottom of the deep (right) well, resting on the surface. Ghost: the same in the shallow (left) well.
const MX = wellBottom(0.3, C.XH - 0.2, C.MZ);
const GX = wellBottom(-C.XH + 0.2, -0.3, C.GZ);
/** Exact distance from a point to the top surface, by dense sampling (setup only). */
function distToSurface(px, py, pz) {
  let best = Infinity;
  for (let x = px - 0.6; x <= px + 0.6; x += 0.004) {
    for (let z = pz - 0.6; z <= pz + 0.6; z += 0.004) {
      const dy = py - topY(x, z), dx = px - x, dz = pz - z;
      const d = dx * dx + dy * dy + dz * dz; if (d < best) best = d;
    }
  }
  return Math.sqrt(best);
}
function restY(x, z) { let lo = topY(x, z), hi = lo + 2 * C.R; for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (distToSurface(x, m, z) < C.R) lo = m; else hi = m; } return (lo + hi) / 2 + 0.002; }
const MY = restY(MX, C.MZ);
const GY = restY(GX, C.GZ);
const sdBall = (x, y, z) => Math.hypot(x - MX, y - MY, z - C.MZ) - C.R;

let HIT_ID = 0; // 0 slab, 1 marble
function sdScene(x, y, z) {
  const a = sdSlab(x, y, z), b = sdBall(x, y, z);
  if (b < a) { HIT_ID = 1; return b; }
  HIT_ID = 0; return a;
}

// Bounding box of everything solid.
const TOPMAX = (() => { let m = 0; for (let x = -C.XH; x <= C.XH; x += 0.01) for (let z = -C.ZH; z <= C.ZH; z += 0.02) m = Math.max(m, topY(x, z)); return m; })();
const BB = [-C.XH - 0.01, -0.01, -C.ZH - 0.01, C.XH + 0.01, TOPMAX + 0.05, C.ZH + 0.01];
const BBS = BB.map((v, i) => v + (i < 3 ? -0.35 : 0.35)); // padded, so shadow penumbrae are not clipped
function boxRange(ox, oy, oz, dx, dy, dz, box = BB) {
  let t0 = 0, t1 = 1e9;
  const o = [ox, oy, oz], d = [dx, dy, dz];
  for (let i = 0; i < 3; i++) {
    const inv = 1 / d[i];
    let a = (box[i] - o[i]) * inv, b = (box[i + 3] - o[i]) * inv;
    if (a > b) { const s = a; a = b; b = s; }
    if (a > t0) t0 = a; if (b < t1) t1 = b;
    if (t0 > t1) return null;
  }
  return [t0, t1];
}

// Trail: dots along a path from the ghost in the shallow well, up over the crest, down to the marble.
const TRAIL_DOTS = (() => {
  const pts = [];
  const N = 4000;
  for (let i = 0; i <= N; i++) {
    const s = i / N;
    const x = GX + (MX - GX) * s;
    const z = C.GZ + (C.MZ - C.GZ) * smooth(0.0, 1.0, s);
    pts.push([x, topY(x, z), z]);
  }
  const dots = []; let acc = C.TRAIL_STEP; const step = C.TRAIL_STEP;
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1], pts[i]];
    acc += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    if (acc >= step) {
      const p = b;
      if (Math.hypot(p[0] - GX, p[2] - C.GZ) < C.R * 1.45) continue; // start just outside the ghost
      acc = 0;
      if (Math.hypot(p[0] - MX, p[2] - C.MZ) < C.R * 1.45) break;
      dots.push(p);
    }
  }
  const [a0, a1] = C.TRAIL_A;
  return dots.map((p, i) => [p[0], p[1], p[2], a0 + (a1 - a0) * (i / Math.max(1, dots.length - 1))]);
})();

// ---------------------------------------------------------------- camera
const D2R = Math.PI / 180;
const TGT = C.target;
const EYE = [
  TGT[0] + C.dist * Math.cos(C.elev * D2R) * Math.sin(C.azim * D2R),
  TGT[1] + C.dist * Math.sin(C.elev * D2R),
  TGT[2] + C.dist * Math.cos(C.elev * D2R) * Math.cos(C.azim * D2R),
];
const FWD = norm([TGT[0] - EYE[0], TGT[1] - EYE[1], TGT[2] - EYE[2]]);
const RIGHT = norm(cross(FWD, [0, 1, 0]));
const UP = cross(RIGHT, FWD);
const TY = Math.tan(C.fovY * D2R / 2), TX = TY * C.W / C.H;
function rayDir(sx, sy) {
  const px = (2 * sx / C.W - 1) * TX, py = (1 - 2 * sy / C.H + C.shiftY) * TY;
  return norm([FWD[0] + RIGHT[0] * px + UP[0] * py, FWD[1] + RIGHT[1] * px + UP[1] * py, FWD[2] + RIGHT[2] * px + UP[2] * py]);
}
const CLOUDS = C.clouds.map(([sx, sy, dist, size]) => { const d = rayDir(sx, sy); return [EYE[0] + d[0] * dist, EYE[1] + d[1] * dist, EYE[2] + d[2] * dist, size]; });

// ---------------------------------------------------------------- shading
function normalAt(x, y, z, out) {
  const e = 0.0008;
  const a = sdScene(x + e, y - e, z - e), b = sdScene(x - e, y - e, z + e);
  const c = sdScene(x - e, y + e, z - e), d = sdScene(x + e, y + e, z + e);
  const nx = a - b - c + d, ny = -a - b + c + d, nz = -a + b - c + d;
  const l = Math.hypot(nx, ny, nz) || 1;
  out[0] = nx / l; out[1] = ny / l; out[2] = nz / l; return out;
}

/** Soft shadow toward Ld: the slab by sphere tracing, the marble analytically (Quilez's
 *  sphere soft shadow), so the marble's penumbra is smooth rather than step-banded. */
function softShadow(ox, oy, oz, k, Ld = L, Lm = Ld === L ? ML : Ld) {
  let res = 1;
  // marble
  const cx = ox - MX, cy = oy - MY, cz = oz - C.MZ;
  const b = cx * Lm[0] + cy * Lm[1] + cz * Lm[2];
  const c = cx * cx + cy * cy + cz * cz - C.R * C.R;
  const hb = b * b - c;
  if (b < 0) {
    const d = Math.sqrt(Math.max(0, C.R * C.R - hb)) - C.R;
    const t = -b - Math.sqrt(Math.max(hb, 0));
    if (t > 0) res = smooth(0, 1, 2.5 * C.marbleShadowK * d / t);
  }
  // slab
  const r = boxRange(ox, oy, oz, Ld[0], Ld[1], Ld[2], BBS);
  if (!r) return res;
  let t = Math.max(0.012, r[0]); const tEnd = r[1];
  for (let i = 0; i < 160 && t < tEnd; i++) {
    const h = sdSlab(ox + Ld[0] * t, oy + Ld[1] * t, oz + Ld[2] * t);
    if (h < 0.0004) return 0;
    res = Math.min(res, k * h / t);
    t += clamp(h, 0.006, 0.12);
  }
  return smooth(0, 1, clamp(res, 0, 1));
}

/** Analytic ambient occlusion of a sphere of radius R at (cx, cy, cz), seen from a surface point with normal n. */
function sphereOcc(x, y, z, n, cx, cy, cz) {
  const dx = cx - x, dy = cy - y, dz = cz - z, d = Math.hypot(dx, dy, dz);
  const c = Math.max(0, (n[0] * dx + n[1] * dy + n[2] * dz) / d);
  return clamp(c * (C.R * C.R) / (d * d) * 1.2, 0, 1);
}

function ambientOcc(x, y, z, n) {
  let occ = 0, w = 1;
  for (let i = 1; i <= 5; i++) {
    const hh = 0.03 + 0.09 * i;
    const d = sdScene(x + n[0] * hh, y + n[1] * hh, z + n[2] * hh);
    occ += (hh - d) * w; w *= 0.72;
  }
  return clamp(1 - 1.15 * occ, 0, 1);
}

const BG = [0, 0, 0];
function backdrop(v, h, out) {
  rampAt(BACK, v, out);
  // a soft lighter halo behind the diorama
  const dx = (h - 0.5) * 1.1, dy = (v - 0.47) * 0.95;
  const g = Math.exp(-(dx * dx + dy * dy) / (2 * 0.2 * 0.2)) * 0.22;
  out[0] += (1 - out[0]) * g; out[1] += (1 - out[1]) * g; out[2] += (1 - out[2]) * g;
  return out;
}

/** Environment seen in reflections: a pastel sky dome with a bright soft key light. */
const ENV_Z = hexLin('#8fc6e6'), ENV_H = hexLin('#e3ecf9'), ENV_G = hexLin('#f6dde6');
function envColor(dx, dy, dz, out) {
  if (dy > 0) { const t = Math.pow(dy, 0.6); for (let i = 0; i < 3; i++) out[i] = ENV_H[i] + (ENV_Z[i] - ENV_H[i]) * t; }
  else { const t = Math.min(1, -dy * 3); for (let i = 0; i < 3; i++) out[i] = ENV_H[i] + (ENV_G[i] - ENV_H[i]) * t; }
  const c = dx * L[0] + dy * L[1] + dz * L[2];
  const s = smooth(0.955, 0.985, c) * 5.5 + smooth(0.6, 1, c) * 0.25;
  out[0] += s * KEY[0]; out[1] += s * KEY[1]; out[2] += s * KEY[2];
  return out;
}

const N = [0, 0, 0], ALB = [0, 0, 0], TMP = [0, 0, 0], RC = [0, 0, 0];

const A2 = [0, 0, 0];
/** Albedo of the slab at a surface point: land colour by height on top, strata on the cut faces, and the trail dots. */
function slabAlbedo(x, y, z, n, out) {
  // land on top, layered strata on the cut faces, blended across the bevel by the normal
  const top = topY(x, z);
  rampAt(LAND, y, out);
  const side = 1 - smooth(0.2, 0.55, n[1]);
  if (side > 0) {
    rampAt(STRATA, clamp((top - y) / top, 0, 1), A2);
    for (let i = 0; i < 3; i++) out[i] += (A2[i] - out[i]) * side;
  }
  const onTop = 1 - side;
  if (onTop > 0 && Math.abs(y - top) < 0.03) {
    // a lighter band along the crest between the two wells
    const uc = (x - C.MEANDER * Math.sin(1.25 * z + 0.6)) / C.S - CREST_U;
    const crest = C.CREST_A * Math.exp(-(uc * uc) / (C.CREST_W * C.CREST_W)) * onTop;
    for (let i = 0; i < 3; i++) out[i] += (1 - out[i]) * crest;
    // the trail
    let a = 0;
    for (let i = 0; i < TRAIL_DOTS.length; i++) {
      const d = TRAIL_DOTS[i];
      const dd = Math.hypot(x - d[0], y - d[1], z - d[2]);
      if (dd < C.TRAIL_R + 0.01) a = Math.max(a, d[3] * (1 - smooth(C.TRAIL_R - 0.014, C.TRAIL_R, dd)));
    }
    if (a > 0) for (let i = 0; i < 3; i++) out[i] = s2l(l2s(out[i]) + (TRAIL_S[i] - l2s(out[i])) * a);
  }
  return out;
}

function shadeSlab(x, y, z, n, rdx, rdy, rdz, out, cheap) {
  slabAlbedo(x, y, z, n, ALB);
  const ndl = n[0] * L[0] + n[1] * L[1] + n[2] * L[2];
  // cast shadows fade out where the surface turns away from the light (the wrap term takes over)
  let sh = 1;
  if (!cheap && ndl > 0) sh = 1 + (softShadow(x + n[0] * 0.003, y + n[1] * 0.003, z + n[2] * 0.003, C.shadowK) - 1) * smooth(0, 0.2, ndl);
  let ao = cheap ? 1 : ambientOcc(x, y, z, n);
  if (!cheap) ao *= 1 - C.GHOST * sphereOcc(x, y, z, n, GX, GY, C.GZ);
  const sky = 0.5 + 0.5 * n[1];
  // wrap lighting keeps the shaded sides soft rather than black
  const wrap = Math.max(0, (n[0] * L[0] + n[1] * L[1] + n[2] * L[2] + 0.25) / 1.25);
  const kd = 0.9 * wrap * (0.2 + 0.8 * sh);
  const fl = C.fill * Math.max(0, (n[0] * LF[0] + n[1] * LF[1] + n[2] * LF[2] + 0.2) / 1.2) * ao;
  for (let i = 0; i < 3; i++) {
    const amb = (SKY[i] * sky + BOUNCE[i] * (1 - sky) * 0.6) * 0.5 * ao;
    out[i] = ALB[i] * (KEY[i] * kd + amb + FILL[i] * fl);
  }
  // a faint clay sheen, and a little sky caught at grazing angles (crisps the edges)
  const hx = L[0] - rdx, hy = L[1] - rdy, hz = L[2] - rdz, hl = Math.hypot(hx, hy, hz);
  const spec = Math.pow(Math.max(0, (n[0] * hx + n[1] * hy + n[2] * hz) / hl), 24) * 0.06 * sh;
  const graze = Math.pow(1 - clamp(-(n[0] * rdx + n[1] * rdy + n[2] * rdz), 0, 1), 4) * 0.10 * ao;
  for (let i = 0; i < 3; i++) out[i] += spec + graze * SKY[i];
  return out;
}

/** March a ray against the scene inside its bounding box. Returns t or -1. */
function march(ox, oy, oz, dx, dy, dz, slabOnly) {
  const r = boxRange(ox, oy, oz, dx, dy, dz);
  if (!r) return -1;
  let t = Math.max(r[0], 0.002);
  for (let i = 0; i < 260 && t <= r[1]; i++) {
    const x = ox + dx * t, y = oy + dy * t, z = oz + dz * t;
    const d = slabOnly ? sdSlab(x, y, z) : sdScene(x, y, z);
    if (d < 0.00025 * (1 + t)) return t;
    t += d;
  }
  return -1;
}

const CORE = hexLin('#2c5c99'), CAUSTIC = hexLin('#9bd4e5');
/** A glossy navy glass marble: a body brighter at its core than at its rim, a soft caustic
 *  glow on the side away from the light, Fresnel reflections, and a crisp highlight. */
function shadeMarble(x, y, z, n, rdx, rdy, rdz, out) {
  const cosv = clamp(-(n[0] * rdx + n[1] * rdy + n[2] * rdz), 0, 1);
  const F = 0.04 + 0.96 * Math.pow(1 - cosv, 5);
  const rdn = rdx * n[0] + rdy * n[1] + rdz * n[2];
  const rx = rdx - 2 * rdn * n[0], ry = rdy - 2 * rdn * n[1], rz = rdz - 2 * rdn * n[2];
  const px = x + n[0] * 0.004, py = y + n[1] * 0.004, pz = z + n[2] * 0.004;
  const t = march(px, py, pz, rx, ry, rz, true);
  if (t > 0) {
    const hx = px + rx * t, hy = py + ry * t, hz = pz + rz * t;
    normalAt(hx, hy, hz, TMP);
    shadeSlab(hx, hy, hz, TMP, rx, ry, rz, RC, true);
  } else envColor(rx, ry, rz, RC);
  const ndl = n[0] * L[0] + n[1] * L[1] + n[2] * L[2];
  const sh = ndl > 0 ? softShadow(px, py, pz, C.shadowK) : 0;
  const core = cosv * cosv * 0.55;
  const lit = 0.45 + 0.55 * Math.max(0, ndl) * sh;
  // light focused through the glass lands on the far side, low down
  const cau = Math.pow(Math.max(0, -ndl), 2.2) * smooth(-0.2, 0.6, cosv) * 0.30;
  for (let i = 0; i < 3; i++) {
    const body = (MARBLE[i] + (CORE[i] - MARBLE[i]) * core) * lit + CAUSTIC[i] * cau;
    out[i] = body * (1 - F) + RC[i] * F;
  }
  const hx = L[0] - rdx, hy = L[1] - rdy, hz = L[2] - rdz, hl = Math.hypot(hx, hy, hz);
  const nh = Math.max(0, (n[0] * hx + n[1] * hy + n[2] * hz) / hl);
  const sp = (Math.pow(nh, 260) * 2.2 + Math.pow(nh, 18) * 0.10) * sh;
  for (let i = 0; i < 3; i++) out[i] += sp * KEY[i];
  return out;
}

const GN = [0, 0, 0], GC = [0, 0, 0];
/** The ghost marble's colour (before its opacity): the marble's body, sky reflection and highlight, without shadows. */
function shadeGhost(n, rdx, rdy, rdz, out) {
  const cosv = clamp(-(n[0] * rdx + n[1] * rdy + n[2] * rdz), 0, 1);
  const F = 0.04 + 0.96 * Math.pow(1 - cosv, 5);
  const rdn = rdx * n[0] + rdy * n[1] + rdz * n[2];
  envColor(rdx - 2 * rdn * n[0], rdy - 2 * rdn * n[1], rdz - 2 * rdn * n[2], RC);
  const ndl = n[0] * L[0] + n[1] * L[1] + n[2] * L[2];
  const core = cosv * cosv * 0.55, lit = 0.45 + 0.55 * Math.max(0, ndl);
  for (let i = 0; i < 3; i++) out[i] = (MARBLE[i] + (CORE[i] - MARBLE[i]) * core) * lit * (1 - F) + RC[i] * F;
  const hx = L[0] - rdx, hy = L[1] - rdy, hz = L[2] - rdz, hl = Math.hypot(hx, hy, hz);
  const nh = Math.max(0, (n[0] * hx + n[1] * hy + n[2] * hz) / hl);
  const sp = Math.pow(nh, 260) * 2.2 + Math.pow(nh, 18) * 0.10;
  for (let i = 0; i < 3; i++) out[i] += sp * KEY[i];
  return out;
}

/** Rounded-rectangle distance of the slab's footprint in the floor plane. */
function footprint(x, z) {
  const qx = Math.abs(x) - (C.XH - C.RC), qz = Math.abs(z) - (C.ZH - C.RC);
  const ox = qx > 0 ? qx : 0, oz = qz > 0 ? qz : 0;
  return Math.sqrt(ox * ox + oz * oz) + Math.min(Math.max(qx, qz), 0) - C.RC;
}

/** Floor: a shadow catcher that keeps the backdrop colour and only darkens it, with a
 *  soft pool of shadow under the floating slab (offset along FL) and a tighter core. */
function shadeFloor(x, z, v, h, out) {
  backdrop(v, h, out);
  const lift = -C.floorY;
  const sx = x + FL[0] / FL[1] * lift, sz = z + FL[2] / FL[1] * lift;
  const d = footprint(sx, sz);
  const s = 0.20 * (1 - smooth(-0.55, 0.75, d)) + 0.16 * (1 - smooth(-0.35, 0.22, d));
  for (let i = 0; i < 3; i++) out[i] *= 1 - s * (1 - SHADOW_TINT[i]);
  return out;
}

// ---------------------------------------------------------------- clouds
// Each cloud is a smooth union of a few spheres with its base flattened, shaded with the same lights.
const PUFFS = [[0, 0, 0, 1.0], [-1.15, -0.28, 0.1, 0.72], [1.05, -0.22, -0.1, 0.8], [0.45, 0.42, 0.05, 0.72], [-0.5, 0.3, -0.15, 0.62], [1.75, -0.4, 0.05, 0.5]];
const CLOUD = hexLin(C.cloud);
function smin(a, b, k) { const h = clamp(0.5 + 0.5 * (b - a) / k, 0, 1); return b + (a - b) * h - k * h * (1 - h); }
function sdCloud(x, y, z, c) {
  const s = c[3];
  const px = (x - c[0]) / s, py = (y - c[1]) / s, pz = (z - c[2]) / s;
  let d = 1e9;
  for (let i = 0; i < PUFFS.length; i++) {
    const q = PUFFS[i];
    d = smin(d, Math.hypot(px - q[0], py - q[1], (pz - q[2]) * 1.15) - q[3], 0.35);
  }
  d = smax(d, -(py + 0.42), 0.25);   // flat-ish underside
  return d * s;
}
const sdClouds = (x, y, z) => { let d = 1e9; for (const c of CLOUDS) d = Math.min(d, sdCloud(x, y, z, c)); return d; };
function marchClouds(ox, oy, oz, dx, dy, dz) {
  let best = -1;
  for (const c of CLOUDS) {
    // bounding sphere
    const R = c[3] * 2.4, cx = ox - c[0], cy = oy - c[1], cz = oz - c[2];
    const b = cx * dx + cy * dy + cz * dz, h = b * b - (cx * cx + cy * cy + cz * cz - R * R);
    if (h < 0) continue;
    let t = -b - Math.sqrt(h); const t1 = -b + Math.sqrt(h);
    for (let i = 0; i < 120 && t < t1; i++) {
      const d = sdCloud(ox + dx * t, oy + dy * t, oz + dz * t, c);
      if (d < 0.0008) { if (best < 0 || t < best) best = t; break; }
      t += d;
    }
  }
  return best;
}
function shadeCloud(x, y, z, rdx, rdy, rdz, out) {
  const e = 0.002;
  const nx = sdClouds(x + e, y, z) - sdClouds(x - e, y, z);
  const ny = sdClouds(x, y + e, z) - sdClouds(x, y - e, z);
  const nz = sdClouds(x, y, z + e) - sdClouds(x, y, z - e);
  const l = Math.hypot(nx, ny, nz) || 1;
  const n0 = nx / l, n1 = ny / l, n2 = nz / l;
  const wrap = Math.max(0, (n0 * L[0] + n1 * L[1] + n2 * L[2] + 0.5) / 1.5);
  const sky = 0.5 + 0.5 * n1;
  const rim = Math.pow(1 - clamp(-(n0 * rdx + n1 * rdy + n2 * rdz), 0, 1), 3) * 0.12;
  for (let i = 0; i < 3; i++) out[i] = CLOUD[i] * (KEY[i] * 0.55 * wrap + (SKY[i] * sky + BOUNCE[i] * (1 - sky)) * 0.55) + rim;
  return out;
}

const PIX = [0, 0, 0];
function samplePixel(sx, sy, out) {
  const v = sy / C.H, h = sx / C.W;
  const px = (2 * h - 1) * TX, py = (1 - 2 * v + C.shiftY) * TY;
  let dx = FWD[0] + RIGHT[0] * px + UP[0] * py;
  let dy = FWD[1] + RIGHT[1] * px + UP[1] * py;
  let dz = FWD[2] + RIGHT[2] * px + UP[2] * py;
  const l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
  const t = march(EYE[0], EYE[1], EYE[2], dx, dy, dz, false);
  const tc = marchClouds(EYE[0], EYE[1], EYE[2], dx, dy, dz);
  if (tc > 0 && (t < 0 || tc < t)) {
    shadeCloud(EYE[0] + dx * tc, EYE[1] + dy * tc, EYE[2] + dz * tc, dx, dy, dz, out);
    backdrop(v, h, BG);
    for (let i = 0; i < 3; i++) out[i] += (BG[i] - out[i]) * C.haze;
    return out;
  }
  if (t > 0) {
    const x = EYE[0] + dx * t, y = EYE[1] + dy * t, z = EYE[2] + dz * t;
    sdScene(x, y, z);
    const id = HIT_ID;
    normalAt(x, y, z, N);
    if (id === 1) return shadeMarble(x, y, z, N, dx, dy, dz, out);
    shadeSlab(x, y, z, N, dx, dy, dz, out, false);
    // the ghost marble: a faint see-through copy of the marble where it started
    const cx = EYE[0] - GX, cy = EYE[1] - GY, cz = EYE[2] - C.GZ;
    const b = cx * dx + cy * dy + cz * dz, h = b * b - (cx * cx + cy * cy + cz * cz - C.R * C.R);
    if (h > 0) {
      const tg = -b - Math.sqrt(h);
      if (tg > 0 && tg < t) {
        const gx = EYE[0] + dx * tg, gy = EYE[1] + dy * tg, gz = EYE[2] + dz * tg;
        GN[0] = (gx - GX) / C.R; GN[1] = (gy - GY) / C.R; GN[2] = (gz - C.GZ) / C.R;
        shadeGhost(GN, dx, dy, dz, GC);
        for (let i = 0; i < 3; i++) out[i] = s2l(l2s(out[i]) + (l2s(clamp(GC[i], 0, 1)) - l2s(out[i])) * C.GHOST); // blended in sRGB, like CSS opacity
      }
    }
    return out;
  }
  if (dy < 0) {
    const tf = (C.floorY - EYE[1]) / dy;
    return shadeFloor(EYE[0] + dx * tf, EYE[2] + dz * tf, v, h, out);
  }
  return backdrop(v, h, out);
}

function renderRow(row, buf) {
  const n = C.ss;
  for (let col = 0; col < C.W; col++) {
    let r = 0, g = 0, b = 0;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        samplePixel(col + (i + 0.5) / n, row + (j + 0.5) / n, PIX);
        r += PIX[0]; g += PIX[1]; b += PIX[2];
      }
    }
    const k = 1 / (n * n);
    buf[col * 3] = r * k; buf[col * 3 + 1] = g * k; buf[col * 3 + 2] = b * k;
  }
}

// ---------------------------------------------------------------- main / workers
if (!isMainThread) {
  const { rows } = workerData;
  const out = new Float32Array(rows.length * C.W * 3);
  const buf = new Float32Array(C.W * 3);
  rows.forEach((row, k) => { renderRow(row, buf); out.set(buf, k * C.W * 3); });
  parentPort.postMessage(out, [out.buffer]);
} else {
  const outPath = resolve(process.argv[2] || DEFAULT_OUT);
  const t0 = Date.now();
  const nW = Math.max(1, Math.min(16, (os.availableParallelism?.() ?? os.cpus().length) - 1));
  const assign = Array.from({ length: nW }, () => []);
  for (let row = 0; row < C.H; row++) assign[row % nW].push(row);
  const lin = new Float32Array(C.W * C.H * 3);
  await Promise.all(assign.map((rows) => new Promise((res, rej) => {
    const w = new Worker(new URL(import.meta.url), { workerData: { rows } });
    w.once('message', (data) => { rows.forEach((row, k) => lin.set(data.subarray(k * C.W * 3, (k + 1) * C.W * 3), row * C.W * 3)); res(); });
    w.once('error', rej);
  })));
  const rand = mulberry32(SEED);
  const px = Buffer.alloc(C.W * C.H * 4);
  for (let i = 0, j = 0; i < lin.length; i += 3, j += 4) {
    for (let c = 0; c < 3; c++) {
      let v = lin[i + c];
      v = v > 0.9 ? 0.9 + 0.1 * Math.tanh((v - 0.9) / 0.1) : v;  // soft shoulder
      px[j + c] = clamp(Math.round(l2s(clamp(v, 0, 1)) * 255 + rand() - 0.5), 0, 255);
    }
    px[j + 3] = 255;
  }
  mkdirSync(dirname(outPath), { recursive: true });
  const info = await sharp(px, { raw: { width: C.W, height: C.H, channels: 4 } })
    .removeAlpha()
    .webp({ quality: C.quality, effort: 6, smartSubsample: true })
    .toFile(outPath);
  console.log(`${outPath}  ${C.W}x${C.H}  ${(info.size / 1024).toFixed(1)} KB  ${((Date.now() - t0) / 1000).toFixed(1)} s  (${nW} workers, ss=${C.ss}, marble at x=${MX.toFixed(3)} y=${MY.toFixed(3)}, ghost at x=${GX.toFixed(3)}, ${TRAIL_DOTS.length} trail dots, LIP=${LIP.toFixed(3)})`);
  if (process.env.COVER_DEBUG) {
    const proj = (p) => { const d = [p[0] - EYE[0], p[1] - EYE[1], p[2] - EYE[2]]; const f = d[0] * FWD[0] + d[1] * FWD[1] + d[2] * FWD[2]; const px = (d[0] * RIGHT[0] + d[1] * RIGHT[1] + d[2] * RIGHT[2]) / f / TX, py = (d[0] * UP[0] + d[1] * UP[1] + d[2] * UP[2]) / f / TY; return [(px + 1) / 2 * C.W, (1 + C.shiftY - py) / 2 * C.H]; };
    const ps = []; for (let a = 0; a < 2 * Math.PI; a += 0.01) { const cx = Math.sign(Math.cos(a)) * (C.XH - C.RC) + C.RC * Math.cos(a), cz = Math.sign(Math.sin(a)) * (C.ZH - C.RC) + C.RC * Math.sin(a); ps.push(proj([cx, 0, cz]), proj([cx, topY(cx, cz), cz])); } for (let x = -C.XH; x <= C.XH; x += 0.02) for (let z = -C.ZH; z <= C.ZH; z += 0.05) ps.push(proj([x, topY(x, z), z]));
    console.log('slab bbox (px):', Math.min(...ps.map((p) => p[0])).toFixed(0), Math.min(...ps.map((p) => p[1])).toFixed(0), Math.max(...ps.map((p) => p[0])).toFixed(0), Math.max(...ps.map((p) => p[1])).toFixed(0), ' marble', proj([MX, MY, C.MZ]).map((v) => v.toFixed(0)).join(','), ' ghost', proj([GX, GY, C.GZ]).map((v) => v.toFixed(0)).join(','));
  }
}
