// Cover artwork for /research/neural-pde-stability.
// Run from the site root:  node scripts/cover-art/neural-pde-stability.mjs
// Writes public/research/neural-pde-stability/cover-art.webp (1200 x 1600).
//
// What it shows: a board of soft, bevelled satin tiles (the cells of a grid)
// resting on a navy studio floor, with one smooth wave rolling across it,
// away from the viewer (up and to the right in the picture). The wave lifts
// and tilts each row of tiles as it passes; the crest glows peach, the three
// or four rows it has just passed keep a warm afterglow that fades back to
// the resting violet, and the rows ahead stay cool ice blue. Soft contact
// shadows sit under the lifted rows; there is no floor reflection. The
// backdrop is MTAN navy at the edges with an indigo glow behind the board.
// For a non-specialist: a solver carrying a wave forward one cell at a time.
//
// Math that shapes it (textbook only, nothing from the project): the wave is
// a solitary-wave profile carried along the rows, u(y) = A sech^2((y - y0)/w),
// a shape the advection equation u_t + a u_y = 0 (a > 0) moves without
// change. Row j of tiles (cell [y_j, y_j + dy], dy = 1) stands at the exact
// cell average
//   ubar_j = (A w / dy) [tanh((y_j + dy - y0)/w) - tanh((y_j - y0)/w)],
// and is tilted to the slope (ubar_{j+1} - ubar_{j-1}) / (2 dy). The single
// hump is the only displacement; the afterglow is colour only, a decaying
// exponential in the distance behind the crest. The soft contact shadow under
// each row is the cosine-weighted view factor of a parallel rectangle (the
// row) seen from the floor, i.e. the sky it hides:
//   F(X, Y) = 1/(2 pi) [ X/sqrt(1+X^2) atan(Y/sqrt(1+X^2))
//                      + Y/sqrt(1+Y^2) atan(X/sqrt(1+Y^2)) ],
// X, Y = corner offsets / height, summed over the four corners.
// Rendering: signed distance fields of rounded boxes, sphere-traced, with a
// soft key shadow, ambient occlusion, a warm key, cool fill and rim light,
// bloom and a filmic (ACES) tone curve, at 3 x 3 samples per pixel. The
// backdrop colours are given in display sRGB and pushed through the inverse
// tone curve, so the image edges land on the frame's navy rgb(15, 37, 64).
//
// Deterministic: mulberry32 with the fixed seed SEED = 0x5ca1ab1e picks the
// sub-pixel sample pattern and the dither; nothing else is random. Rows are
// traced in parallel worker threads, but every pixel depends only on its own
// position, so running it twice gives byte-identical output. sharp is
// imported on the main thread only, for the WebP encode.
//
// Options for iteration (not needed for the real build):
//   --out=<file>   write somewhere else (.webp or .png)
//   --scale=<s>    render at s times the size (e.g. 0.3 for a quick preview)
//   --ss=<n>       n x n samples per pixel (default 3)
//   CFG='{"key": value}' env var overrides entries of CFG below.

import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SEED = 0x5ca1ab1e;
const OUT = join(dirname(fileURLToPath(import.meta.url)), '../../public/research/neural-pde-stability/cover-art.webp');

/** mulberry32: small seeded PRNG, uniform on [0, 1). */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const CFG = {
  W: 1200, H: 1600, ss: 3,
  // board of tiles (world units: one cell = 1; x across the rows, y along the travel, z up)
  NX: 8, NY: 18,
  tile: 0.84,          // tile side (gap = 1 - tile)
  thick: 0.34,         // tile thickness
  round: 0.16,         // corner (bevel) radius
  dome: 0.2,           // slight doming of the tile tops, for a satin gradient
  // wave u(y) = A sech^2((y - y0)/w), y measured from the board centre; it travels towards +y
  A: 1.9, w: 2.3, y0: -0.5,
  trail: 2.1,          // afterglow decay length behind the crest, in rows
  trailI: 1.0,         // afterglow strength just behind the crest
  // camera: orbit the look-at point
  yaw: -18,            // degrees, view direction from +y towards +x (the wave rolls up and to the right)
  elev: 40,            // degrees above the floor
  dist: 30,
  fov: 38.6,           // vertical field of view, degrees
  look: [0, 0, 0.6],
  shiftX: 0.16,        // lens shift (fraction of half-width), + moves the board right
  shiftY: 0.07,        // lens shift (fraction of half-height), + moves the board up
  // lights: azimuth (from +y towards +x) and elevation, degrees
  key: [-100, 52], keyI: 0.38, // warm key from the upper left of the picture
  keySoft: 8,          // soft-shadow sharpness (higher = harder)
  ambI: 0.3,
  rim: [90, 24],
  back: [-15, 36],      // soft light behind the board, seen as a sheen on the tiles
  backI: 0.4, backP: 24,
  gloss: 0.85,
  bevelI: 1.0,         // highlight on the bevels facing the key light
  rimEdgeI: 1.0,       // rim highlight on the bevels facing the back light
  glow: 0.9,           // self-glow of the tiles at the crest
  glowBase: 0.03,      // faint glow of every tile
  spill: 0.7, spillW: 1.5, // crest light falling on the tiles around it
  pool: 0.2, poolFrom: 3, poolLen: 6, // light fall-off over the front rows (fraction, start and length in rows)
  // floor
  contact: 0.5,        // strength of the contact shadow (view-factor occlusion)
  keyShadow: 0.3,      // strength of the soft directional key shadow on the floor
  floorSoft: 1.5,      // its sharpness (low = a wide, soft penumbra)
  // finish
  exposure: 1.0,
  bloom: [0.14, 0.12],
  // backdrop, display sRGB: navy edges, soft royal blue, indigo glow behind the board
  bgEdge: '#0f2540',   // MTAN navy, rgb(15, 37, 64)
  bgMid: '#26386f',    // muted royal blue
  bgGlow: '#4a3f8f',   // indigo
  bgCore: '#6a5cad',   // brightest point of the glow
  glowC: [0.5, 0.42],   // glow centre (u, v)
  glowR: [0.56, 0.5],  // glow radii (u, v)
  edgeW: 0.2,          // width of the band (fraction of the width) that settles on navy at the edges
  // tiles and lights (sRGB): violet / periwinkle tiles, pastel light; no greens
  tileLow: '#6b6fc4',  // resting tiles, front of the board (violet)
  tileFar: '#6c88d6',  // resting tiles, back of the board (periwinkle)
  tileCool: '#93b4f0', // ice blue, the rows ahead of the crest
  coolRest: 0.35,      // how far the resting rows ahead lean to ice blue
  tileMid: '#b9a2ee',  // lilac
  tileWarm: '#dc9fe0', // orchid pink, the fading afterglow
  tileHigh: '#f59cc6', // soft pink
  tilePeak: '#ffb38f', // peach, at the crest
  keyCol: '#fff1e6',
  rimCol: '#f2b8de',
  skyFill: '#8fb6ea',  // ice blue
  bounce: '#4a3a8e',
  sheen: '#e9c6f0',    // pink-lilac sheen
  halo: '#d9c8ff',     // lilac, reflected in the tile sides
  warmFloor: '#f59cc6',
};

// ---------------------------------------------------------------------------
// Scene, shared by the main thread and the workers
// ---------------------------------------------------------------------------
const srgbToLin = (s) => (s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4);
function lin(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => srgbToLin(c / 255));
}
// ACES fit used by finish(): y = x (a x + b) / (x (c x + d) + e)
const AC = [2.51, 0.03, 2.43, 0.59, 0.14];
/** Inverse of the ACES fit, so a display colour can be asked for exactly. */
function acesInv(y) {
  const [a, b, c, d, e] = AC;
  const qa = y * c - a, qb = y * d - b, qc = y * e;
  return (-qb - Math.sqrt(qb * qb - 4 * qa * qc)) / (2 * qa);
}

function makeScene(cfg) {
  const deg = Math.PI / 180;
  const { NX, NY, A, w, y0 } = cfg;
  const halfX = NX / 2, halfY = NY / 2;
  // cell averages of u over each row's cell [y_j, y_j + 1], y_j = j - NY/2
  const avg = new Float64Array(NY + 2);
  for (let j = -1; j <= NY; j++) {
    const a = j - halfY, b = a + 1;
    avg[j + 1] = A * w * (Math.tanh((b - y0) / w) - Math.tanh((a - y0) / w));
  }
  const zc = new Float64Array(NY), cth = new Float64Array(NY), sth = new Float64Array(NY);
  const lvl = new Float64Array(NY), heat = new Float64Array(NY), side = new Float64Array(NY);
  let top = 0;
  for (let j = 0; j < NY; j++) {
    const th = Math.atan((avg[j + 2] - avg[j]) / 2);
    zc[j] = cfg.thick / 2 + avg[j + 1];
    cth[j] = Math.cos(th); sth[j] = Math.sin(th);
    lvl[j] = avg[j + 1] / A;
    // distance behind the crest (rows the crest has already passed are at y < y0)
    const d = y0 - (j - halfY + 0.5);
    const trail = d > 0 ? cfg.trailI * Math.exp(-(d - 0.5) / cfg.trail) : 0;
    side[j] = d > 0 ? 1 : 0;
    // ahead of the crest the colour cools off faster than the height falls
    heat[j] = d > 0 ? Math.max(lvl[j], Math.min(1, trail)) : lvl[j] ** 1.8;
    top = Math.max(top, zc[j]);
  }
  const dir = (az, el) => [Math.sin(az * deg) * Math.cos(el * deg), Math.cos(az * deg) * Math.cos(el * deg), Math.sin(el * deg)];
  const C = {};
  for (const k of ['tileLow', 'tileFar', 'tileCool', 'tileMid', 'tileWarm', 'tileHigh', 'tilePeak', 'keyCol', 'rimCol', 'skyFill', 'bounce', 'sheen', 'halo', 'warmFloor']) C[k] = lin(cfg[k]);
  // backdrop stops: display-linear, interpolated, then pushed through acesInv per sample
  for (const k of ['bgEdge', 'bgMid', 'bgGlow', 'bgCore']) C[k] = lin(cfg[k]);
  // camera
  const ya = cfg.yaw * deg, el = cfg.elev * deg;
  const [lx, ly, lz] = cfg.look;
  const o = [lx - cfg.dist * Math.sin(ya) * Math.cos(el), ly - cfg.dist * Math.cos(ya) * Math.cos(el), lz + cfg.dist * Math.sin(el)];
  let f = [lx - o[0], ly - o[1], lz - o[2]];
  const fl = Math.hypot(...f); f = f.map((v) => v / fl);
  const r = [Math.cos(ya), -Math.sin(ya), 0];
  const up = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  return {
    halfX, halfY, zc, cth, sth, lvl, heat, side, avg, C, o, f, r, up,
    Lk: dir(...cfg.key), Lr: dir(...cfg.rim), Lb: dir(...cfg.back),
    top: top + cfg.tile,
  };
}

function traceRows(cfg, S, y0Row, y1Row, offs) {
  const { W, H, NX, NY } = cfg;
  const { halfX, halfY, zc, cth, sth, lvl, heat, side, avg, C, o, f, r, up, Lk, Lr, Lb, top } = S;
  const bx = cfg.tile / 2 - cfg.round, by = cfg.tile / 2 - cfg.round, bz = cfg.thick / 2 - cfg.round, rad = cfg.round;
  const tanV = Math.tan((cfg.fov * Math.PI) / 360), tanH = (tanV * W) / H;

  // signed distance to the nearest tile; leaves the winning row in hitRow
  let hitRow = -1;
  function sdTiles(px, py, pz) {
    let ci = Math.floor(px + halfX);
    if (ci < 0) ci = 0; else if (ci >= NX) ci = NX - 1;
    const qx = Math.abs(px - (ci - halfX + 0.5)) - bx;
    const cj = Math.floor(py + halfY);
    let best = 1e9;
    for (let j = cj - 1; j <= cj + 1; j++) {
      const jj = j < 0 ? 0 : j >= NY ? NY - 1 : j;
      if (jj !== j && (j < -1 || j > NY)) continue;
      const dy = py - (jj - halfY + 0.5), dz = pz - zc[jj];
      // into the tile frame (tilt about x)
      const ly = cth[jj] * dy + sth[jj] * dz, lz = -sth[jj] * dy + cth[jj] * dz;
      const qy = Math.abs(ly) - by, qz = Math.abs(lz) - bz;
      const mx = qx > 0 ? qx : 0, my = qy > 0 ? qy : 0, mz = qz > 0 ? qz : 0;
      const inner = Math.min(Math.max(qx, qy, qz), 0);
      const d = Math.sqrt(mx * mx + my * my + mz * mz) + inner - rad;
      if (d < best) { best = d; hitRow = jj; }
    }
    return best;
  }
  const sdScene = (px, py, pz) => Math.min(sdTiles(px, py, pz), pz);

  // board bounding box
  const BX = halfX + 0.2, BY = halfY + 0.6;
  const span = [0, 0];
  function boxSpan(ox, oy, oz, dx, dy, dz) {
    let t0 = 0, t1 = 1e9;
    const lo = [-BX, -BY, -0.01], hi = [BX, BY, top], oo = [ox, oy, oz], dd = [dx, dy, dz];
    for (let a = 0; a < 3; a++) {
      if (Math.abs(dd[a]) < 1e-12) { if (oo[a] < lo[a] || oo[a] > hi[a]) return false; continue; }
      let ta = (lo[a] - oo[a]) / dd[a], tb = (hi[a] - oo[a]) / dd[a];
      if (ta > tb) { const s = ta; ta = tb; tb = s; }
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
      if (t0 > t1) return false;
    }
    span[0] = t0; span[1] = t1;
    return true;
  }

  function softShadow(px, py, pz, L, k) {
    if (!boxSpan(px, py, pz, L[0], L[1], L[2])) return 1;
    let res = 1, t = Math.max(0.02, span[0]);
    const tEnd = span[1];
    for (let i = 0; i < 80 && t < tEnd; i++) {
      const h = sdTiles(px + L[0] * t, py + L[1] * t, pz + L[2] * t);
      res = Math.min(res, (k * h) / t);
      if (res < 0.002) return 0;
      t += Math.min(Math.max(h, 0.02), 0.35);
    }
    res = Math.max(0, Math.min(1, res));
    return res * res * (3 - 2 * res);
  }

  function ao(px, py, pz, nx, ny, nz) {
    let occ = 0, sc = 1;
    for (let i = 1; i <= 5; i++) {
      const hd = 0.05 + 0.13 * i;
      const d = sdScene(px + nx * hd, py + ny * hd, pz + nz * hd);
      occ += (hd - d) * sc; sc *= 0.72;
    }
    return Math.max(0, Math.min(1, 1 - 1.5 * occ));
  }

  // cosine-weighted view factor from a floor point to the rectangle [x1,x2] x [y1,y2]
  // at height h above it (corner form, odd in X and Y, so corners superpose)
  const INV2PI = 1 / (2 * Math.PI);
  function fc(X, Y) {
    const sx = Math.sqrt(1 + X * X), sy = Math.sqrt(1 + Y * Y);
    return INV2PI * ((X / sx) * Math.atan(Y / sx) + (Y / sy) * Math.atan(X / sy));
  }
  const xL = -halfX + (1 - cfg.tile) / 2, xR = halfX - (1 - cfg.tile) / 2;
  function contactOcc(px, py) {
    let occ = 0;
    const X1 = xL - px, X2 = xR - px;
    for (let j = 0; j < NY; j++) {
      const yc = j - halfY + 0.5;
      const h = avg[j + 1] + cfg.thick * 0.5;
      const Y1 = yc - cfg.tile / 2 - py, Y2 = yc + cfg.tile / 2 - py;
      if (Math.min(Math.abs(Y1), Math.abs(Y2)) > 8 * h + 2 && Y1 * Y2 > 0) continue;
      const ih = 1 / h;
      occ += fc(X2 * ih, Y2 * ih) - fc(X1 * ih, Y2 * ih) - fc(X2 * ih, Y1 * ih) + fc(X1 * ih, Y1 * ih);
    }
    return Math.min(1, occ);
  }

  // studio backdrop (scene-linear) at normalised screen position (u, v), v = 0 at the top
  const tmp = [0, 0, 0];
  function backdrop(u, v, out) {
    const ex = (u - cfg.glowC[0]) / cfg.glowR[0], ey = (v - cfg.glowC[1]) / cfg.glowR[1];
    const q = Math.sqrt(ex * ex + ey * ey); // 0 at the glow centre, 1 on the ellipse
    const s = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    const kCore = 1 - s(0, 0.45, q), kGlow = 1 - s(0.1, 0.75, q), kMid = 1 - s(0.35, 1.05, q);
    // and settle on pure navy along every edge, so the picture melts into the frame
    const de = Math.min(u, 1 - u, ((v < 0.5 ? v : 1 - v) * H) / W);
    const kIn = s(0, cfg.edgeW, de);
    for (let c = 0; c < 3; c++) {
      let x = C.bgEdge[c];
      x += (C.bgMid[c] - x) * kMid;
      x += (C.bgGlow[c] - x) * kGlow;
      x += (C.bgCore[c] - x) * kCore * 0.6;
      tmp[c] = C.bgEdge[c] + (x - C.bgEdge[c]) * kIn;
    }
    for (let c = 0; c < 3; c++) out[c] = acesInv(tmp[c]);
  }

  // colour ramps by heat: ahead of the crest via cool lilac, behind it via a warm orchid pink
  const coolRamp = [null, C.tileMid, C.tileHigh, C.tilePeak];
  const warmRamp = [null, C.tileWarm, C.tileHigh, C.tilePeak];
  const base = [0, 0, 0], lowC = [0, 0, 0], glowCol = [0, 0, 0], sheenC = [0, 0, 0], edgeC = [0, 0, 0];
  function shadeTile(px, py, pz, dx, dy, dz, j, out) {
    // analytic normal of the rounded box, in the tile frame, rotated back
    let ci = Math.floor(px + halfX);
    if (ci < 0) ci = 0; else if (ci >= NX) ci = NX - 1;
    const lx = px - (ci - halfX + 0.5), ddy = py - (j - halfY + 0.5), ddz = pz - zc[j];
    const ly = cth[j] * ddy + sth[j] * ddz, lz = -sth[j] * ddy + cth[j] * ddz;
    const qx = Math.abs(lx) - bx, qy = Math.abs(ly) - by, qz = Math.abs(lz) - bz;
    let nx, ny, nz;
    if (qx > 0 || qy > 0 || qz > 0) {
      nx = Math.max(qx, 0) * Math.sign(lx); ny = Math.max(qy, 0) * Math.sign(ly); nz = Math.max(qz, 0) * Math.sign(lz);
    } else if (qx > qy && qx > qz) { nx = Math.sign(lx); ny = 0; nz = 0; }
    else if (qy > qz) { nx = 0; ny = Math.sign(ly); nz = 0; }
    else { nx = 0; ny = 0; nz = Math.sign(lz); }
    let nl = 1 / Math.hypot(nx, ny, nz);
    nx *= nl; ny *= nl; nz *= nl;
    // bevel zone: the rounded band between the flat top and the sides (0 on the top, 1 at the side)
    const bevel = nz > 0 ? Math.min(1, Math.max(0, 1 - nz) * 1.6) * (nz > 0.05 ? 1 : 0) : 0;
    // dome the top slightly so each tile carries a soft gradient, like satin
    if (nz > 0) { nx += cfg.dome * nz * (lx / (cfg.tile / 2)); ny += cfg.dome * nz * (ly / (cfg.tile / 2)); }
    const wy = cth[j] * ny - sth[j] * nz, wz = sth[j] * ny + cth[j] * nz;
    nl = 1 / Math.hypot(nx, wy, wz);
    nx *= nl; ny = wy * nl; nz = wz * nl;
    // base colour from the row's heat: resting violet -> lilac -> pink -> peach;
    // rows ahead of the crest rest towards ice blue
    const h = heat[j];
    const fb = Math.min(1, Math.max(0, (py + halfY) / (2 * halfY)));
    const ahead = 1 - side[j];
    const coolK = ahead * (cfg.coolRest + (1 - cfg.coolRest) * Math.min(1, lvl[j] * 2.2)) * 0.8;
    for (let c = 0; c < 3; c++) {
      lowC[c] = C.tileLow[c] + (C.tileFar[c] - C.tileLow[c]) * fb;
      lowC[c] += (C.tileCool[c] - lowC[c]) * coolK;
    }
    const tt = Math.min(2.999, Math.max(0, h * 3)), k0 = Math.floor(tt), fr = tt - k0;
    const ramp = side[j] ? warmRamp : coolRamp;
    const r0 = k0 === 0 ? lowC : ramp[k0];
    for (let c = 0; c < 3; c++) base[c] = r0[c] + (ramp[k0 + 1][c] - r0[c]) * fr;
    const g1 = ramp[Math.min(3, k0 + 1)];
    // highlights turn icy on the rows ahead of the crest, so that side stays cool and crisp
    for (let c = 0; c < 3; c++) {
      glowCol[c] = g1[c];
      sheenC[c] = C.sheen[c] + (C.skyFill[c] - C.sheen[c]) * ahead * 0.8;
      edgeC[c] = C.rimCol[c] + (C.skyFill[c] - C.rimCol[c]) * ahead * 0.8;
    }
    const sh = softShadow(px + nx * 0.01, py + ny * 0.01, pz + nz * 0.01, Lk, cfg.keySoft);
    const oc = ao(px, py, pz, nx, ny, nz);
    const ndk = Math.max(0, nx * Lk[0] + ny * Lk[1] + nz * Lk[2]);
    const ndr = Math.max(0, nx * Lr[0] + ny * Lr[1] + nz * Lr[2]);
    const ndb = Math.max(0, nx * Lb[0] + ny * Lb[1] + nz * Lb[2]);
    const hemi = 0.5 + 0.5 * nz;
    const cosV = Math.max(0, -(dx * nx + dy * ny + dz * nz));
    const F = 0.04 + 0.96 * (1 - cosV) ** 5;
    const spec = (L, p) => {
      const hx = L[0] - dx, hy = L[1] - dy, hz = L[2] - dz;
      const hl = 1 / Math.hypot(hx, hy, hz);
      return Math.max(0, (nx * hx + ny * hy + nz * hz) * hl) ** p;
    };
    const sk = spec(Lk, 60) * sh * 1.2 + spec(Lk, 10) * sh * 0.12;
    const sr = spec(Lr, 30) * 0.8;
    // sheen of the soft light behind the board
    const sb = cfg.backI * (spec(Lb, cfg.backP) + 0.35 * spec(Lb, cfg.backP / 5)) * (0.3 + F);
    // bevel highlights: warm where the bevel faces the key, pink-lilac where it faces the back light
    const bk = cfg.bevelI * bevel * ndk ** 2 * (0.4 + 0.6 * sh);
    const br = cfg.rimEdgeI * bevel * (ndb ** 3 + 0.6 * ndr ** 3);
    // reflected studio: a soft ice-blue dome with a lilac-pink glow low on the rim side
    const k2 = 2 * (dx * nx + dy * ny + dz * nz);
    const rx = dx - k2 * nx, ry = dy - k2 * ny, rz = dz - k2 * nz;
    const rr = Math.max(0, rx * Lr[0] + ry * Lr[1] + rz * Lr[2]);
    const dome = Math.max(0, rz);
    const selfGlow = cfg.glowBase + cfg.glow * h * h;
    // light from the glowing crest and afterglow falling on the tiles around it (wider behind the crest)
    const dyc = py - cfg.y0, ww = cfg.w * cfg.spillW * (dyc < 0 ? 1.25 : 0.6);
    const cw = Math.cosh(dyc / ww), spill = (cfg.spill / (cw * cw)) * (0.4 + 0.6 * Math.max(0, nz));
    // the studio light pools on the wave: the nearest resting rows sit a little lower in the light
    const pf = Math.min(1, Math.max(0, (-dyc - cfg.poolFrom) / cfg.poolLen));
    const pool = 1 - cfg.pool * pf * pf * (3 - 2 * pf);
    for (let c = 0; c < 3; c++) {
      const amb = (C.bounce[c] + (C.skyFill[c] - C.bounce[c]) * hemi) * cfg.ambI * oc;
      let v = base[c] * (C.keyCol[c] * ndk * sh * cfg.keyI + amb + C.rimCol[c] * ndr * 0.22);
      v += (C.keyCol[c] * sk + edgeC[c] * sr) * (0.25 + F) + sheenC[c] * sb;
      v += C.keyCol[c] * bk + edgeC[c] * br * oc;
      const env = C.skyFill[c] * 0.28 * dome + C.rimCol[c] * 0.5 * rr ** 6 + C.halo[c] * 0.22 * (1 - dome) ** 3;
      v += F * cfg.gloss * env * oc;
      v += selfGlow * glowCol[c] * (0.5 + 0.5 * oc) + spill * base[c] * C.tileHigh[c] * oc;
      out[c] = v * pool;
    }
  }

  // continuous version of the row heat, for light the rows throw on the floor
  function heatAt(y) {
    const d = cfg.y0 - y, c = Math.cosh(d / cfg.w), lv = 1 / (c * c);
    return d > 0 ? Math.max(lv, Math.min(1, cfg.trailI * Math.exp(-(d - 0.5) / cfg.trail))) : lv ** 1.8;
  }

  const bd = [0, 0, 0];
  function shadeGround(px, py, u, v, out) {
    backdrop(u, v, bd);
    // computed over the whole visible floor: the wide penumbra must not end at a cut-off line
    const sh = softShadow(px, py, 0.001, Lk, cfg.floorSoft), occ = contactOcc(px, py);
    const light = (1 - cfg.contact * occ) * (1 - cfg.keyShadow * (1 - sh));
    // warm light under the glowing and afterglowing rows
    let spill = 0;
    const ex = Math.abs(px) - (halfX - 0.6);
    if (ex < 1 && py > -halfY && py < halfY) {
      // smooth in y (not row by row) and kept under the board in x
      const hy = heatAt(py), fx = ex < 0 ? 1 : 1 - ex * ex * (3 - 2 * ex);
      spill = hy * hy * fx;
    }
    for (let c = 0; c < 3; c++) out[c] = bd[c] * light + spill * 0.06 * C.warmFloor[c] * (1 - 0.5 * occ);
  }

  const buf = new Float32Array((y1Row - y0Row) * W * 3);
  const col = [0, 0, 0];
  const nS = offs.length / 2;
  for (let py = y0Row; py < y1Row; py++) {
    for (let px = 0; px < W; px++) {
      let ar = 0, ag = 0, ab = 0;
      for (let s = 0; s < offs.length; s += 2) {
        const u = (px + offs[s]) / W, v = (py + offs[s + 1]) / H;
        const sx = u * 2 - 1 - cfg.shiftX, sy = 1 - v * 2 - cfg.shiftY;
        let dx = f[0] + sx * tanH * r[0] + sy * tanV * up[0];
        let dy = f[1] + sx * tanH * r[1] + sy * tanV * up[1];
        let dz = f[2] + sx * tanH * r[2] + sy * tanV * up[2];
        const dl = 1 / Math.hypot(dx, dy, dz); dx *= dl; dy *= dl; dz *= dl;
        let done = false;
        if (boxSpan(o[0], o[1], o[2], dx, dy, dz)) {
          let t = span[0];
          const tEnd = span[1];
          for (let i = 0; i < 220 && t < tEnd; i++) {
            const qx = o[0] + dx * t, qy = o[1] + dy * t, qz = o[2] + dz * t;
            const dt = sdTiles(qx, qy, qz);
            if (dt < 2e-4 * (1 + t * 0.05)) { shadeTile(qx, qy, qz, dx, dy, dz, hitRow, col); done = true; break; }
            t += dt * 0.92;
          }
        }
        if (!done) {
          if (dz < 0) {
            const t = -o[2] / dz;
            shadeGround(o[0] + dx * t, o[1] + dy * t, u, v, col);
          } else backdrop(u, v, col);
        }
        ar += col[0]; ag += col[1]; ab += col[2];
      }
      const k = ((py - y0Row) * W + px) * 3;
      buf[k] = ar / nS; buf[k + 1] = ag / nS; buf[k + 2] = ab / nS;
    }
  }
  return buf;
}

// ---------------------------------------------------------------------------
// Post: bloom, tone curve, dither
// ---------------------------------------------------------------------------
function blur(src, W, H, rad) {
  const a = Float32Array.from(src), b = new Float32Array(src.length);
  const pass = (from, to, horiz) => {
    const n = horiz ? W : H, m = horiz ? H : W, norm = 1 / (2 * rad + 1);
    for (let l = 0; l < m; l++) {
      for (let c = 0; c < 3; c++) {
        const idx = (i) => (horiz ? l * W + i : i * W + l) * 3 + c;
        let acc = 0;
        for (let i = -rad; i <= rad; i++) acc += from[idx(Math.min(n - 1, Math.max(0, i)))];
        for (let i = 0; i < n; i++) {
          to[idx(i)] = acc * norm;
          acc += from[idx(Math.min(n - 1, i + rad + 1))] - from[idx(Math.max(0, i - rad))];
        }
      }
    }
  };
  for (let k = 0; k < 3; k++) { pass(a, b, true); pass(b, a, false); }
  return a;
}

function finish(img, cfg) {
  const { W, H } = cfg;
  const rand = mulberry32(SEED ^ 0x9e3779b9);
  const bright = new Float32Array(img.length);
  for (let i = 0; i < img.length; i += 3) {
    const l = 0.2126 * img[i] + 0.7152 * img[i + 1] + 0.0722 * img[i + 2];
    const k = Math.max(0, l - 0.45) / Math.max(l, 1e-6);
    bright[i] = img[i] * k; bright[i + 1] = img[i + 1] * k; bright[i + 2] = img[i + 2] * k;
  }
  const s = W / 1200;
  const b1 = blur(bright, W, H, Math.max(1, Math.round(5 * s)));
  const b2 = blur(bright, W, H, Math.max(1, Math.round(30 * s)));
  const out = Buffer.alloc(W * H * 3);
  const [a, b, c2, d, e] = AC;
  const aces = (x) => (x * (a * x + b)) / (x * (c2 * x + d) + e);
  const srgb = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
  for (let i = 0; i < img.length; i++) {
    let v = img[i] + cfg.bloom[0] * b1[i] + cfg.bloom[1] * b2[i];
    v = aces(Math.max(0, v * cfg.exposure));
    v = srgb(Math.min(1, v)) * 255 + (rand() + rand() - 1) * 0.6;
    out[i] = Math.max(0, Math.min(255, Math.round(v)));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Main thread: split rows across workers, then post-process and encode
// ---------------------------------------------------------------------------
const isEntry = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (!isMainThread) {
  const { cfg, y0Row, y1Row, offs } = workerData;
  const buf = traceRows(cfg, makeScene(cfg), y0Row, y1Row, offs);
  parentPort.postMessage(buf, [buf.buffer]);
} else if (isEntry) {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
  const scale = args.scale ? +args.scale : 1;
  const cfg = { ...CFG, ...(process.env.CFG ? JSON.parse(process.env.CFG) : {}) };
  cfg.W = Math.round(cfg.W * scale); cfg.H = Math.round(cfg.H * scale);
  if (args.ss) cfg.ss = +args.ss;
  const rand = mulberry32(SEED);
  const offs = [];
  for (let j = 0; j < cfg.ss; j++) for (let i = 0; i < cfg.ss; i++) offs.push((i + 0.25 + 0.5 * rand()) / cfg.ss, (j + 0.25 + 0.5 * rand()) / cfg.ss);

  const t0 = Date.now();
  const nW = Math.max(1, Math.min(16, availableParallelism()));
  const chunk = Math.max(1, Math.ceil(cfg.H / (nW * 4)));
  const jobs = [];
  for (let y = 0; y < cfg.H; y += chunk) jobs.push([y, Math.min(cfg.H, y + chunk)]);
  const img = new Float32Array(cfg.W * cfg.H * 3);
  const self = fileURLToPath(import.meta.url);
  await new Promise((resolve, reject) => {
    let next = 0, live = 0;
    const launch = () => {
      if (next >= jobs.length) { if (live === 0) resolve(); return; }
      const [a, b] = jobs[next++];
      live++;
      const wk = new Worker(self, { workerData: { cfg, y0Row: a, y1Row: b, offs } });
      wk.once('message', (buf) => img.set(buf, a * cfg.W * 3));
      wk.once('error', reject);
      wk.once('exit', () => { live--; launch(); });
    };
    for (let k = 0; k < nW; k++) launch();
  });
  const t1 = Date.now();
  const rgb = finish(img, cfg);
  const { default: sharp } = await import('sharp');
  const outPath = args.out || OUT;
  mkdirSync(dirname(outPath), { recursive: true });
  const pipe = sharp(rgb, { raw: { width: cfg.W, height: cfg.H, channels: 3 } });
  const info = await (outPath.endsWith('.png')
    ? pipe.png({ compressionLevel: 9 })
    : pipe.webp({ quality: 84, effort: 6, smartSubsample: true })
  ).toFile(outPath);
  console.log(`wrote ${outPath}: ${cfg.W}x${cfg.H}, ${(info.size / 1024).toFixed(1)} KB, trace ${((t1 - t0) / 1000).toFixed(1)} s, total ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
