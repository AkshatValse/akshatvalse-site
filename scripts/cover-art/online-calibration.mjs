// Cover artwork for /research/online-calibration (the "vsl" gray theme).
// Run from the site root:  node scripts/cover-art/online-calibration.mjs [out.webp|out.png]
// Writes public/research/online-calibration/cover-art.webp (1200 x 1600, opaque, WebP q84).
//
// What it shows: a tower of soft clay blocks, stacked one at a time, rising through a
// floating disc of frosted glass. The disc is the range a forecast expects the tower's
// final height to land in: two thin rings trace its bottom edge (the low end) and its top
// edge (the high end). The tower already pokes out through the top, and the block that
// took it over is the one cool-blue piece, while one more gray block is still dropping
// onto the stack, so the stacking is not finished. Layman reading: it is already over the
// line before it is done.
//
// The math that shapes it is only the premise stated in the project's public abstract:
// block k adds a height x_k >= 0, so the tower's height S_k = x_1 + ... + x_k never goes
// down, and once some S_k is above the disc's top the final height S_n is too. The block
// heights below are hand-picked; nothing here is the project's method, data or results.
//
// How it is made: a small signed-distance-field ray marcher in plain JS. Blocks are
// rounded boxes (seeded small twists and offsets make the stack look hand-placed); the
// rings are tori (they cast no shadows: thin ring shadows read as smudges). The disc is a
// rounded cylinder (the code calls it the slab) treated as a frosted volume: each camera
// ray finds where it enters and leaves it (sphere tracing its own SDF), and what lies
// behind or inside is veiled by Beer-Lambert absorption over the path length inside,
// under a lit skin with Fresnel and a little extra light on the rounded edges; shadow rays
// lose light through it the same way, with edges softened by distance. Light: a warm soft key
// (wrapped Lambert with SDF penumbra shadows), a cool fill, a cool rim from behind, sky
// and floor-bounce ambient with SDF ambient occlusion, and a Blinn-Phong sheen. The floor
// is the plane y = 0, every camera ray reaches it, and its colour is a screen-space gray
// gradient (Gaussian-blended stops, so no Mach bands) with a soft pool of light, darkened
// by the key shadow and an ambient-occlusion contact shadow. One sample per pixel first,
// then a jittered 4 x 4 grid on every pixel at an edge. Rows are shared out over worker
// threads; every pixel is a pure function of its coordinates, so the output does not
// depend on the thread count.
//
// Deterministic: the only randomness (block twists and offsets, sub-pixel jitter and a
// +-0.5 LSB dither before 8-bit quantisation) comes from mulberry32 seeded with
// SEED = 4127 below.

import sharp from 'sharp';
import os from 'node:os';
import { mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker, isMainThread, parentPort } from 'node:worker_threads';

const SEED = 4127;
const SELF = fileURLToPath(import.meta.url);
const OUT = join(dirname(SELF), '../../public/research/online-calibration/cover-art.webp');

export const CFG = {
  W: 1200, H: 1600, quality: 84, seed: SEED,
  aa: 4,                 // AA grid (aa x aa) on edge pixels
  edgeLum: 0.025,        // relative luminance step that marks a pixel as an edge
  exposure: 1.0,
  // Camera: orbit angles in degrees (az from the front, el above the floor), looking at target.
  camera: { target: [0.0, 2.5, 0.0], az: -32, el: 30, dist: 14.5, fov: 25 },
  // Lights: directions point TOWARD the light (az, el in degrees). The key is upper left
  // on screen, the fill comes from the right, the rim from behind on the right.
  key: { az: 50, el: 52, col: [1.0, 0.955, 0.9], k: 5, wrap: 0.3 },
  fill: { az: -75, el: 12, col: [0.3, 0.34, 0.42] },
  rim: { az: -155, el: 30, col: [0.55, 0.62, 0.75], gain: 0.5 },
  sky: [0.36, 0.38, 0.42], bounce: [0.2, 0.21, 0.23],
  // The tower: block width, edge rounding, hand-picked block heights (bottom to top),
  // which block crossed the slab's top (index), and the seeded jitter (degrees, units).
  tower: {
    w: 1.0, round: 0.09,
    heights: [0.6, 0.44, 0.62, 0.4, 0.52, 0.42, 0.62],
    cross: 6,
    yawJitter: 8, xzJitter: 0.04, yaw0: 4,
  },
  // The block still dropping in: gap above the stack, height, tilt (degrees), offset, and
  // the strength and softness of its shadow.
  drop: { gap: 0.5, h: 0.5, yaw: 26, pitch: 9, roll: -13, dx: 0.08, dz: -0.04, shadow: 0.35, shadowK: 2.5 },
  // The frosted slab (the forecast range): a disc ('round') or a square slab ('box') of
  // radius / half width s, from height lo to hi; edge rounding; absorption for camera rays
  // and for shadow rays, and the softness of its shadow edge (a + b * distance); the edge
  // glint; and two thin rings (radius rim, 0 = none) along its top and bottom edges.
  slab: { shape: 'round', s: 1.62, lo: 2.18, hi: 3.2, round: 0.22, sigma: 1.5, shadowSigma: 0.4, shadowSoft: [0.1, 0.22], edge: 0.22, rim: 0.022, rimInset: 0.07 },
  // Floor: a screen-space gradient (v = 0 bottom, 1 top), Gaussian-blended stops,
  // a soft pool of light behind the subject, and a cool shadow tint.
  floorStops: [[0, '#bfc6ce'], [0.42, '#dfe3e7'], [0.72, '#e6e9ec'], [1, '#d3d8de']],
  stopSigma: 0.24,
  pool: { x: 0.8, z: 2.0, r: 4.0, gain: 0.16 },
  floorShadowK: 3.0, floorShadow: [0.65, 0.6], shadowMul: [0.6, 0.64, 0.72],
  vignette: 0.14,
  // sRGB colours: cool grays, slate, off-white and charcoal; one cool blue (the block
  // that crossed). No greens.
  col: {
    blocks: ['#4b535e', '#8d98a6', '#d9dee4', '#6d7886', '#b4bcc6', '#5b6572'],
    cross: '#5480b2',
    drop: '#8c97a4',
    slab: '#a3afbd',
    rim: '#727d8b',
  },
};

// Optional overrides for exploring variants, e.g. COVER_CFG='{"camera":{"az":-28}}' and
// COVER_SCALE=0.5 for a quick half-size preview. The published file uses neither.
const deepMerge = (a, b) => { for (const k of Object.keys(b)) { if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k])) deepMerge(a[k], b[k]); else a[k] = b[k]; } return a; };
if (process.env.COVER_CFG) deepMerge(CFG, JSON.parse(process.env.COVER_CFG));
const SCALE = +(process.env.COVER_SCALE || 1);
const W = Math.round(CFG.W * SCALE), H = Math.round(CFG.H * SCALE);

// ---------------------------------------------------------------- helpers
const D2R = Math.PI / 180;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lin = (h) => [1, 3, 5].map((i) => { const c = parseInt(h.slice(i, i + 2), 16) / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
const enc = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const norm3 = (v) => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dirOf = (az, el) => [Math.sin(az * D2R) * Math.cos(el * D2R), Math.sin(el * D2R), -Math.cos(az * D2R) * Math.cos(el * D2R)];

/** mulberry32: small seeded PRNG, uniform on [0, 1). */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pixelRng = (i, salt) => mulberry32((SEED ^ Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(salt, 0x85ebca6b)) >>> 0);

/** Rotation matrix (local -> world), R = Ry(yaw) Rx(pitch) Rz(roll), row-major. */
function rotMat(yaw, pitch, roll) {
  const cy = Math.cos(yaw * D2R), sy = Math.sin(yaw * D2R);
  const cx = Math.cos(pitch * D2R), sx = Math.sin(pitch * D2R);
  const cz = Math.cos(roll * D2R), sz = Math.sin(roll * D2R);
  const Ry = [cy, 0, sy, 0, 1, 0, -sy, 0, cy], Rx = [1, 0, 0, 0, cx, -sx, 0, sx, cx], Rz = [cz, -sz, 0, sz, cz, 0, 0, 0, 1];
  const mul = (A, B) => { const C = new Array(9).fill(0); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) C[i * 3 + j] += A[i * 3 + k] * B[k * 3 + j]; return C; };
  return mul(mul(Ry, Rx), Rz);
}

// ---------------------------------------------------------------- scene
// Blocks bottom to top, then the dropping block. Material id of block i is 1 + i.
const BLOCKS = (() => {
  const rand = mulberry32(SEED);
  const T = CFG.tower, out = [];
  let y = 0;
  for (const h of T.heights) {
    const yaw = T.yaw0 + (rand() * 2 - 1) * T.yawJitter;
    const ox = (rand() * 2 - 1) * T.xzJitter, oz = (rand() * 2 - 1) * T.xzJitter;
    out.push({ c: [ox, y + h / 2, oz], hb: [T.w / 2, h / 2, T.w / 2], R: rotMat(yaw, 0, 0) });
    y += h;
  }
  const D = CFG.drop;
  // (+0.12 keeps the tilted block's lowest corner about `gap` above the stack)
  out.push({ c: [D.dx, y + D.gap + D.h / 2 + 0.12, D.dz], hb: [T.w / 2, D.h / 2, T.w / 2], R: rotMat(D.yaw, D.pitch, D.roll) });
  out.top = y;
  return out;
})();
const NB = BLOCKS.length;
// Packed per block: centre (3), half sizes (3), rotation (9), bounding radius (1).
const BL = new Float64Array(NB * 16);
BLOCKS.forEach((b, i) => BL.set([...b.c, ...b.hb, ...b.R, Math.hypot(...b.hb)], i * 16));
const RB = CFG.tower.round;
const SL = CFG.slab, SL_CY = (SL.lo + SL.hi) / 2, SL_HY = (SL.hi - SL.lo) / 2;

let MAT = 0, D_STACK = 1e9, D_DROP = 1e9;
const MAT_RIM = 30;
/** Distance to block i (a rounded box in its own frame). */
function blockSD(i, x, y, z) {
  const o = i * 16;
  const px = x - BL[o], py = y - BL[o + 1], pz = z - BL[o + 2];
  const lx = BL[o + 6] * px + BL[o + 9] * py + BL[o + 12] * pz;     // world -> local: R^T p
  const ly = BL[o + 7] * px + BL[o + 10] * py + BL[o + 13] * pz;
  const lz = BL[o + 8] * px + BL[o + 11] * py + BL[o + 14] * pz;
  const qx = Math.abs(lx) - BL[o + 3] + RB, qy = Math.abs(ly) - BL[o + 4] + RB, qz = Math.abs(lz) - BL[o + 5] + RB;
  const mx = qx > 0 ? qx : 0, my = qy > 0 ? qy : 0, mz = qz > 0 ? qz : 0;
  return Math.sqrt(mx * mx + my * my + mz * mz) + Math.min(Math.max(qx, qy, qz), 0) - RB;
}
/** Scene SDF of the opaque parts: blocks and rings (the floor and the frosted slab are
 *  handled analytically). Sets MAT, D_STACK (the stack alone) and D_DROP (the dropping
 *  block alone). */
function map(x, y, z) {
  let d = 1e9, m = 0;
  for (let i = 0; i < NB - 1; i++) {
    const o = i * 16;
    // cheap bound: outside the block's bounding sphere by more than the current best
    const bx = x - BL[o], by = y - BL[o + 1], bz = z - BL[o + 2];
    if (Math.sqrt(bx * bx + by * by + bz * bz) - BL[o + 15] > d) continue;
    const db = blockSD(i, x, y, z);
    if (db < d) { d = db; m = 1 + i; }
  }
  D_STACK = d;
  D_DROP = blockSD(NB - 1, x, y, z);
  if (D_DROP < d) { d = D_DROP; m = NB; }
  if (SL.rim > 0) {
    // thin rings (tori, made for the round shape) along the slab's top and bottom edges: the
    // two bounds. They are left out of D_STACK and D_DROP, so they cast no shadows and add no
    // ambient occlusion: thin ring shadows read as smudges.
    const rr = Math.sqrt(x * x + z * z) - (SL.s - SL.rimInset);
    for (const ry of [SL.lo + SL.rimInset, SL.hi - SL.rimInset]) {
      const dr = Math.sqrt(rr * rr + (y - ry) * (y - ry)) - SL.rim;
      if (dr < d) { d = dr; m = MAT_RIM; }
    }
  }
  MAT = m;
  return d;
}

/** SDF of the frosted slab: a rounded box centred on the tower's axis. */
function slabSD(x, y, z) {
  const r = SL.round;
  if (SL.shape === 'round') {
    const qr = Math.sqrt(x * x + z * z) - SL.s + r, qy = Math.abs(y - SL_CY) - SL_HY + r;
    return Math.hypot(qr > 0 ? qr : 0, qy > 0 ? qy : 0) + Math.min(Math.max(qr, qy), 0) - r;
  }
  const qx = Math.abs(x) - SL.s + r, qy = Math.abs(y - SL_CY) - SL_HY + r, qz = Math.abs(z) - SL.s + r;
  return Math.hypot(qx > 0 ? qx : 0, qy > 0 ? qy : 0, qz > 0 ? qz : 0) + Math.min(Math.max(qx, qy, qz), 0) - r;
}

// ---------------------------------------------------------------- camera and lights
const CAM = (() => {
  const { target, az, el, dist, fov } = CFG.camera;
  const off = dirOf(az, el);
  const pos = [target[0] + off[0] * dist, target[1] + off[1] * dist, target[2] + off[2] * dist];
  const f = norm3([target[0] - pos[0], target[1] - pos[1], target[2] - pos[2]]);
  const r = norm3(cross3(f, [0, 1, 0]));
  const u = cross3(r, f);
  return { pos, f, r, u, th: Math.tan((fov * D2R) / 2), aspect: W / H };
})();
const KEY = dirOf(CFG.key.az, CFG.key.el), FILL = dirOf(CFG.fill.az, CFG.fill.el), RIM = dirOf(CFG.rim.az, CFG.rim.el);

const PAL = (() => {
  const p = CFG.col.blocks.map(lin);
  p[CFG.tower.cross] = lin(CFG.col.cross);
  p[CFG.tower.heights.length] = lin(CFG.col.drop);
  const q = [null, ...p];                              // indexed by material id
  q[MAT_RIM] = lin(CFG.col.rim);
  return q;
})();
const C_SLAB = lin(CFG.col.slab);
const STOPS = CFG.floorStops.map(([t, h]) => [t, lin(h)]);

/** Ray interval through an axis-aligned box [lo, hi], or null. */
function boxHit(lo, hi, ox, oy, oz, dx, dy, dz) {
  let t0 = 0, t1 = 1e9;
  const o = [ox, oy, oz], d = [dx, dy, dz];
  for (let i = 0; i < 3; i++) {
    const inv = 1 / d[i];
    let a = (lo[i] - o[i]) * inv, b = (hi[i] - o[i]) * inv;
    if (a > b) { const q = a; a = b; b = q; }
    if (a > t0) t0 = a;
    if (b < t1) t1 = b;
    if (t0 > t1) return null;
  }
  return [t0, t1];
}
// Bounding boxes: one tight box for camera rays; shadow rays use boxes padded by the widest
// penumbra (k h / t < 1 needs h < t / k), so no shadow is cut off at a box face.
const BR = Math.max(0.9, SL.rim > 0 ? SL.s + 0.1 : 0), TOP = BLOCKS[NB - 1].c[1] + 1.0;
const BOX_LO = [-BR, -0.01, -BR], BOX_HI = [BR, TOP, BR];                    // all opaque parts
const SHB = 2.6, SH_LO = [-BR - SHB, -0.01, -BR - SHB], SH_HI = [BR + SHB, TOP + SHB, BR + SHB];
const SLAB_LO = [-SL.s, SL.lo, -SL.s], SLAB_HI = [SL.s, SL.hi, SL.s];
const SLP = 1.2, SLS_LO = [-SL.s - SLP, SL.lo - SLP, -SL.s - SLP], SLS_HI = [SL.s + SLP, SL.hi + SLP, SL.s + SLP];

function march(ox, oy, oz, dx, dy, dz) {
  const hb = boxHit(BOX_LO, BOX_HI, ox, oy, oz, dx, dy, dz);
  if (!hb) return -1;
  let t = hb[0];
  for (let i = 0; i < 300 && t < hb[1]; i++) {
    const h = map(ox + dx * t, oy + dy * t, oz + dz * t);
    if (h < 0.0004) return t;
    t += h * 0.9;
  }
  return -1;
}

/** Transmittance of the slab along a shadow ray, with edges softened by distance. */
function slabTrans(px, py, pz, dx, dy, dz) {
  const bb = boxHit(SLS_LO, SLS_HI, px, py, pz, dx, dy, dz);
  if (!bb) return 1;
  let L = 0;
  const step = 0.05;
  for (let t = Math.max(bb[0], 0.01) + step / 2; t < bb[1]; t += step) {
    const sd = slabSD(px + dx * t, py + dy * t, pz + dz * t);
    const w = SL.shadowSoft[0] + SL.shadowSoft[1] * t;
    L += step * smooth(w, -w, sd);
  }
  return Math.exp(-SL.shadowSigma * L);
}

/** Soft shadow toward a light: SDF penumbra estimate min(k h / t), times the slab's
 *  transmittance. The dropping block casts a softer, lighter shadow than the stack (an
 *  illustrator's choice: a full shadow on the blue block's top made it read as a hollow box). */
function softShadow(ox, oy, oz, dx, dy, dz, k) {
  let res = 1, resD = 1;
  const hb = boxHit(SH_LO, SH_HI, ox, oy, oz, dx, dy, dz);
  if (hb) {
    let t = Math.max(0.01, hb[0]);
    for (let i = 0; i < 140 && t < hb[1]; i++) {
      map(ox + dx * t, oy + dy * t, oz + dz * t);
      const hD = D_DROP, hS = D_STACK;
      if (hS < 0.0003) { res = 0; break; }
      res = Math.min(res, (k * hS) / t);
      resD = Math.min(resD, (CFG.drop.shadowK * Math.max(hD, 0)) / t);
      t += clamp(Math.min(hS, hD), 0.01, 0.3);
    }
    res = clamp(res, 0, 1);
    res = res * res * (3 - 2 * res);
    resD = clamp(resD, 0, 1);
    resD = 1 - CFG.drop.shadow * (1 - resD * resD * (3 - 2 * resD));
  }
  return res * resD * slabTrans(ox, oy, oz, dx, dy, dz);
}

function calcAO(px, py, pz, nx, ny, nz) {
  let occ = 0, sca = 1;
  for (let i = 0; i < 5; i++) {
    const h = 0.02 + 0.08 * i;
    map(px + nx * h, py + ny * h, pz + nz * h);
    occ += (h - Math.min(D_STACK, D_DROP)) * sca;              // the thin rims add no occlusion
    sca *= 0.75;
  }
  // the floor occludes too: the lowest part of the stack is a little darker
  return clamp(1 - 1.3 * occ, 0.42, 1) * (0.78 + 0.22 * smooth(0, 0.6, py));
}

function normalAt(x, y, z) {
  const e = 0.0015;
  const a = map(x + e, y - e, z - e), b = map(x - e, y - e, z + e), c = map(x - e, y + e, z - e), d = map(x + e, y + e, z + e);
  const nx = a - b - c + d, ny = -a - b + c + d, nz = -a + b - c + d;
  const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
  return [nx / l, ny / l, nz / l];
}

/** Floor albedo: Gaussian-blended stops over screen height v, plus a pool of light. */
function floorAlbedo(v, px, pz) {
  let ws = 0, r = 0, g = 0, b = 0;
  for (const [t, c] of STOPS) {
    const w = Math.exp(-(((v - t) / CFG.stopSigma) ** 2));
    ws += w; r += w * c[0]; g += w * c[1]; b += w * c[2];
  }
  const P = CFG.pool;
  const gain = 1 + P.gain * Math.exp(-((px - P.x) ** 2 + (pz - P.z) ** 2) / (P.r * P.r));
  return [(r / ws) * gain, (g / ws) * gain, (b / ws) * gain];
}

function shadeBlock(px, py, pz, dx, dy, dz, m) {
  const [nx, ny, nz] = normalAt(px, py, pz);
  const alb = PAL[m];
  const spec = m === 1 + CFG.tower.cross ? 0.24 : 0.16, shin = m === 1 + CFG.tower.cross ? 30 : 22;
  const eps = 0.003;
  const wrap = CFG.key.wrap;
  const dif = clamp((nx * KEY[0] + ny * KEY[1] + nz * KEY[2] + wrap) / (1 + wrap), 0, 1);
  const sh = dif > 0 ? softShadow(px + nx * eps, py + ny * eps, pz + nz * eps, KEY[0], KEY[1], KEY[2], CFG.key.k) : 0;
  const ao = calcAO(px, py, pz, nx, ny, nz);
  const fdl = clamp((nx * FILL[0] + ny * FILL[1] + nz * FILL[2] + 0.25) / 1.25, 0, 1);
  const skyW = 0.5 + 0.5 * ny;
  let hx = KEY[0] - dx, hy = KEY[1] - dy, hz = KEY[2] - dz;
  const hl = Math.sqrt(hx * hx + hy * hy + hz * hz); hx /= hl; hy /= hl; hz /= hl;
  const ndh = clamp(nx * hx + ny * hy + nz * hz, 0, 1);
  const ndv = clamp(-(nx * dx + ny * dy + nz * dz), 0, 1);
  const fres = 0.04 + 0.96 * (1 - ndv) ** 5;
  const sp = spec * ndh ** shin * sh * (0.5 + fres);
  const rim = CFG.rim.gain * (1 - ndv) ** 2 * clamp(nx * RIM[0] + ny * RIM[1] + nz * RIM[2], 0, 1) * ao;
  const out = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    const amb = (CFG.sky[k] * skyW + CFG.bounce[k] * (1 - skyW)) * ao;
    out[k] = alb[k] * (CFG.key.col[k] * dif * sh + amb + CFG.fill.col[k] * fdl * ao) + sp * CFG.key.col[k] + rim * CFG.rim.col[k] * 0.5;
  }
  return out;
}

function shadeFloor(px, pz, v) {
  const base = floorAlbedo(v, px, pz);
  const shK = softShadow(px, 0.001, pz, KEY[0], KEY[1], KEY[2], CFG.floorShadowK);
  // contact shadow: ambient occlusion straight up from the floor point (bounded reach)
  let ao = 0, wsum = 0;
  for (let i = 1; i <= 6; i++) {
    const h = 0.06 * i * i + 0.05, w = 1 / i;
    map(px, h, pz);
    ao += w * clamp((h - Math.min(D_STACK, D_DROP)) / h, 0, 1); wsum += w;
  }
  const occ = clamp((1 - shK) * CFG.floorShadow[0] + (ao / wsum) * CFG.floorShadow[1] * 2, 0, 1);
  return [0, 1, 2].map((k) => base[k] * (1 - occ * (1 - CFG.shadowMul[k])));
}

/** The frosted slab over a colour `col` seen at ray depth tHit (in place). Returns true if crossed. */
function veil(col, ox, oy, oz, dx, dy, dz, tHit) {
  const bb = boxHit(SLAB_LO, SLAB_HI, ox, oy, oz, dx, dy, dz);
  if (!bb || bb[0] >= tHit) return false;
  let t = bb[0], tin = -1;
  for (let i = 0; i < 80 && t < Math.min(bb[1], tHit); i++) {
    const sd = slabSD(ox + dx * t, oy + dy * t, oz + dz * t);
    if (sd < 1e-4) { tin = t; break; }
    t += sd;
  }
  if (tin < 0) return false;
  // leave the slab: inside, -sd is the distance to the surface, a safe step
  let tout = tin + 0.002;
  for (let i = 0; i < 200 && tout < bb[1] + 0.01; i++) {
    const sd = slabSD(ox + dx * tout, oy + dy * tout, oz + dz * tout);
    if (sd > 0) break;
    tout += Math.max(-sd, 0.004);
  }
  const L = Math.min(tout, tHit) - tin;
  const qx = ox + dx * tin, qy = oy + dy * tin, qz = oz + dz * tin, e = 0.002;
  let nx = slabSD(qx + e, qy, qz) - slabSD(qx - e, qy, qz), ny = slabSD(qx, qy + e, qz) - slabSD(qx, qy - e, qz), nz = slabSD(qx, qy, qz + e) - slabSD(qx, qy, qz - e);
  const nl = Math.hypot(nx, ny, nz); nx /= nl; ny /= nl; nz /= nl;
  const ndl = clamp((nx * KEY[0] + ny * KEY[1] + nz * KEY[2] + 0.35) / 1.35, 0, 1);
  const sh = softShadow(qx + nx * 0.01, qy + ny * 0.01, qz + nz * 0.01, KEY[0], KEY[1], KEY[2], CFG.key.k);
  const fdl = clamp((nx * FILL[0] + ny * FILL[1] + nz * FILL[2] + 0.3) / 1.3, 0, 1);
  const ndv = clamp(-(nx * dx + ny * dy + nz * dz), 0, 1);
  const fres = 0.04 + 0.96 * (1 - ndv) ** 5;
  const hx = KEY[0] - dx, hy = KEY[1] - dy, hz = KEY[2] - dz, hl = Math.hypot(hx, hy, hz);
  const sp = 0.35 * clamp((nx * hx + ny * hy + nz * hz) / hl, 0, 1) ** 60 * sh;
  const a = 1 - Math.exp(-SL.sigma * L);                 // Beer-Lambert veil
  const ae = a + (1 - a) * fres * 0.6;
  // the rounded edges catch a little more light, like polished glass edges
  const edge = SL.edge * smooth(0.02, 0.3, 1 - Math.max(Math.abs(nx), Math.abs(ny), Math.abs(nz)));
  const skyW = 0.5 + 0.5 * ny;
  for (let k = 0; k < 3; k++) {
    const lit = C_SLAB[k] * (CFG.key.col[k] * ndl * sh * 0.8 + (CFG.sky[k] * skyW + CFG.bounce[k] * (1 - skyW)) * 1.1 + CFG.fill.col[k] * fdl * 0.6);
    col[k] = col[k] * (1 - ae) + lit * ae + sp + edge * CFG.key.col[k];
  }
  return true;
}

/** Returns [r, g, b, id] in linear light (id: what was hit, for edge detection). */
function shade(ox, oy, oz, dx, dy, dz, v) {
  const t = march(ox, oy, oz, dx, dy, dz);
  let col, id, tHit;
  if (t > 0) {
    const px = ox + dx * t, py = oy + dy * t, pz = oz + dz * t;
    map(px, py, pz);
    id = MAT;
    col = shadeBlock(px, py, pz, dx, dy, dz, id);
    tHit = t;
  } else {
    // the camera looks down steeply enough that every ray reaches the floor
    tHit = -oy / dy;
    col = shadeFloor(ox + dx * tHit, oz + dz * tHit, v);
    id = 0;
  }
  if (veil(col, ox, oy, oz, dx, dy, dz, tHit)) id += 64;
  return [col[0], col[1], col[2], id];
}

function primary(sx, sy) {
  const { pos, f, r, u, th, aspect } = CAM;
  const x = (2 * sx / W - 1) * th * aspect, y = (1 - 2 * sy / H) * th;
  let dx = f[0] + r[0] * x + u[0] * y, dy = f[1] + r[1] * x + u[1] * y, dz = f[2] + r[2] * x + u[2] * y;
  const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
  dx /= l; dy /= l; dz /= l;
  return shade(pos[0], pos[1], pos[2], dx, dy, dz, 1 - sy / H);
}

// ---------------------------------------------------------------- workers
if (!isMainThread) {
  parentPort.on('message', (task) => {
    if (task.type === 'pass1') {
      const rows = task.rows;
      const col = new Float32Array(rows.length * W * 3), ids = new Int32Array(rows.length * W);
      let k = 0;
      for (const y of rows) for (let x = 0; x < W; x++, k++) {
        const c = primary(x + 0.5, y + 0.5);
        col[k * 3] = c[0]; col[k * 3 + 1] = c[1]; col[k * 3 + 2] = c[2]; ids[k] = c[3];
      }
      parentPort.postMessage({ type: 'pass1', rows, col, ids }, [col.buffer, ids.buffer]);
    } else {
      const idx = task.idx, n = CFG.aa, col = new Float32Array(idx.length * 3);
      for (let j = 0; j < idx.length; j++) {
        const i = idx[j], px = i % W, py = (i / W) | 0, rnd = pixelRng(i, 1);
        let r = 0, g = 0, b = 0;
        for (let a = 0; a < n; a++) for (let c = 0; c < n; c++) {
          const s = primary(px + (c + rnd()) / n, py + (a + rnd()) / n);
          r += s[0]; g += s[1]; b += s[2];
        }
        col[j * 3] = r / (n * n); col[j * 3 + 1] = g / (n * n); col[j * 3 + 2] = b / (n * n);
      }
      parentPort.postMessage({ type: 'pass2', idx, col }, [col.buffer]);
    }
  });
}

// ---------------------------------------------------------------- main
async function main() {
  const t0 = Date.now();
  const nW = Math.max(1, Math.min(16, +(process.env.COVER_THREADS || os.cpus().length)));
  const workers = Array.from({ length: nW }, () => new Worker(SELF));
  const run = (tasks) => new Promise((done, fail) => {
    const results = [];
    let next = 0, finished = 0;
    const feed = (w) => { if (next < tasks.length) w.postMessage(tasks[next++]); };
    for (const w of workers) {
      w.removeAllListeners('message');
      w.on('message', (m) => { results.push(m); if (++finished === tasks.length) done(results); else feed(w); });
      w.on('error', fail);
      feed(w);
    }
  });

  // pass 1: one sample per pixel, in bands of 8 rows
  const tasks1 = [];
  for (let y = 0; y < H; y += 8) tasks1.push({ type: 'pass1', rows: Array.from({ length: Math.min(8, H - y) }, (_, i) => y + i) });
  const col = new Float32Array(W * H * 3), ids = new Int32Array(W * H);
  for (const m of await run(tasks1)) m.rows.forEach((y, ri) => {
    col.set(m.col.subarray(ri * W * 3, (ri + 1) * W * 3), y * W * 3);
    ids.set(m.ids.subarray(ri * W, (ri + 1) * W), y * W);
  });
  const t1 = Date.now();

  // pass 2: a jittered aa x aa grid on every edge pixel (id change or a luminance step)
  const lum = (i) => 0.2126 * col[i * 3] + 0.7152 * col[i * 3 + 1] + 0.0722 * col[i * 3 + 2];
  const edges = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, li = lum(i);
    let e = false;
    for (let oy = -1; oy <= 1 && !e; oy++) for (let ox = -1; ox <= 1; ox++) {
      const xx = x + ox, yy = y + oy;
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      const j = yy * W + xx;
      if (ids[j] !== ids[i] || Math.abs(lum(j) - li) > CFG.edgeLum * Math.max(0.25, li)) { e = true; break; }
    }
    if (e) edges.push(i);
  }
  const tasks2 = [];
  for (let k = 0; k < edges.length; k += 2000) tasks2.push({ type: 'pass2', idx: Int32Array.from(edges.slice(k, k + 2000)) });
  for (const m of await run(tasks2)) m.idx.forEach((i, j) => { col[i * 3] = m.col[j * 3]; col[i * 3 + 1] = m.col[j * 3 + 1]; col[i * 3 + 2] = m.col[j * 3 + 2]; });
  const t2 = Date.now();
  await Promise.all(workers.map((w) => w.terminate()));

  // vignette, soft shoulder, sRGB, +-0.5 LSB dither
  const shoulder = (c) => (c < 0.8 ? c : 0.8 + 0.2 * (1 - Math.exp(-(c - 0.8) / 0.2)));
  const buf = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, rnd = pixelRng(i, 2);
    const vx = (x / W - 0.5) / 0.75, vy = (y / H - 0.5) / 0.8;
    const vig = 1 - CFG.vignette * (vx * vx + vy * vy);
    for (let k = 0; k < 3; k++) {
      const v = enc(shoulder(Math.max(0, col[i * 3 + k] * CFG.exposure * vig))) * 255 + (rnd() - 0.5);
      buf[i * 3 + k] = clamp(Math.round(v), 0, 255);
    }
  }
  const out = resolve(process.argv[2] || OUT);
  mkdirSync(dirname(out), { recursive: true });
  const img = sharp(buf, { raw: { width: W, height: H, channels: 3 } });
  if (out.endsWith('.png')) await img.png().toFile(out);
  else await img.webp({ quality: CFG.quality, effort: 6, smartSubsample: true }).toFile(out);
  console.log(`wrote ${out} ${(statSync(out).size / 1024).toFixed(1)} KB  pass1 ${(t1 - t0) / 1000}s  edges ${edges.length}  pass2 ${(t2 - t1) / 1000}s  total ${(Date.now() - t0) / 1000}s  (seed ${SEED}, ${nW} threads, stack top ${BLOCKS.top.toFixed(2)}, slab ${SL.lo}..${SL.hi})`);
}

if (isMainThread && process.argv[1] && resolve(process.argv[1]) === SELF) await main();
