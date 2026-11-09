// Cover artwork for /research/langevin (the "mtan" colour theme).
// Run from the site root:  node scripts/cover-art/langevin.mjs
// Writes public/research/langevin/cover-art.webp (1200 x 1600, opaque, WebP q84).
//
// What it shows: a rounded clay tray floating over a navy studio floor, seen in
// a 3/4 view from 40 degrees above. Its top is a smooth egg-crate landscape of
// 4 x 5 round cups. Small glossy pearls (peach, pink, lilac, ice blue) rest in
// the cups, two to five in most of them. Four are still on the move: two are
// crossing the low pass between neighbouring cups and two are partway up a
// slope, each followed by a short dotted trail, one dot per time step, that
// keeps the step-to-step jitter. Plain reading: beads jostled at random that
// end up resting in the low spots.
//
// Math that shapes it (textbook only; nothing from the manuscript):
//   tray top   y = A V(x, z),   V(x, z) = cos x + cos z,   A = 0.95,
// the periodic potential of the public langevin-samplers demo. Cups (wells) sit
// at (pi, pi) + 2 pi Z^2, hilltops at 2 pi Z^2 and the passes (saddles, V = 0)
// halfway between neighbouring cups; the tray is cut along hilltop ridges, so
// every cup is closed and the side walls show the cosine profile.
//   Resting pearls: positions drawn by rejection sampling from the Boltzmann
//   density exp(-beta V), beta = 3, restricted to their cup, then nudged apart so
//   pearls do not overlap, off the trails, and a little downhill.
//   Moving pearls: overdamped Langevin dynamics dX = -grad V(X) dt + sqrt(2/beta) dW,
//   integrated by Euler-Maruyama with dt = 0.12 from the bottom of a cup until
//   the pearl is just over the chosen pass, or a set distance up the chosen slope.
//   The trail is the last 22 to 32 steps, a dot at each step joined by a faint
//   line, fading toward the oldest step.
//   Art choices, not physics: which cup each mover starts in and which way it
//   leaves, and that its trail starts down in the cup (sample paths that fail
//   either test are rejected and re-drawn from the next sub-seed); pearls per
//   cup (2 to 5, at most 2 in a cup a mover is leaving or entering); pearl size
//   and colours.
//
// How: a small sphere-tracing renderer in plain JS (signed distance fields for
// the tray and the pearls; the tray's height-field distance is scaled by its
// Lipschitz bound 1 / sqrt(1 + 2 A^2)), soft shadows, ambient occlusion, a warm
// key light, a cool fill, a pink-lilac rim light, Fresnel reflections on the
// pearls, a soft shadow on the floor, a faint bloom and a soft tone shoulder,
// with 3 x 3 supersampling per pixel. The studio backdrop is the one the
// Learned PDE cover uses: MTAN navy rgb(15, 37, 64) along every edge, easing
// into an indigo glow behind the subject. Rows are split over worker threads;
// every pixel is a pure function of its coordinates, so the output does not
// depend on the number of threads. sharp encodes the WebP; a highlight guard
// (see the encode step) keeps every decoded channel below 255. About 5 s.
//
// Deterministic: SEED = 20260509 seeds mulberry32 sub-streams for the pearl
// positions, counts and colours, the Brownian increments of the movers (one
// sub-stream per mover and attempt), the sub-pixel sample offsets and the
// +-0.5 LSB dither. Two runs give byte-identical files.
//
// Preview hooks (the published file uses none of them):
//   COVER_SCALE=0.4   render smaller        COVER_SS=1   fewer samples
//   COVER_OUT=file.png|webp   write elsewhere
//   COVER_CFG='{"elev":38}'   override CFG entries      COVER_DEBUG=1   print mover positions

import sharp from 'sharp';
import os from 'node:os';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

const SEED = 20260509;
const DEFAULT_OUT = join(dirname(fileURLToPath(import.meta.url)), '../../public/research/langevin/cover-art.webp');

const BASE_CFG = {
  W: 1200, H: 1600, ss: 3, quality: 84,
  // Tray: NX x NZ cups; top y = A V(x, z); footprint |x| <= NX pi + PAD, |z| <= NZ pi + PAD.
  NX: 4, NZ: 5, A: 0.95, PAD: 0.35, RC: 2.4, BEVEL: 0.75, BEVEL2: 0.45,
  T: 3.0,              // thickness of the tray below the deepest point of a cup
  GAP: 3.0,            // how high the tray floats above the studio floor
  // Pearls
  R: 0.72,             // radius
  beta: 3,             // inverse temperature of the Boltzmann density / Langevin dynamics
  dt: 0.12,            // Euler-Maruyama step
  settle: 60,          // relaxation sweeps (nudging apart, settling downhill)
  counts: null,        // optional explicit pearls per cup (row-major, k * NX + i)
  moverGap: 1.4,       // extra room kept around a moving pearl
  srcMax: 2,           // at most this many resting pearls in a cup a mover has just left
  dstMax: 2,           // ... and in the cup a pass-crosser is heading into
  colorW: [0.32, 0.3, 0.14, 0.24], // peach, pink, lilac, ice blue
  // Movers: start cup [i, k], direction of travel [sx, sz], 'pass' (just over the saddle by `over`)
  // or 'slope' (stopped `reach` up the slope), trail of the last K steps, starting within `start` of the cup bottom.
  movers: [
    { cup: [2, 2], dir: [-1, 0], mode: 'pass', over: 0.1, K: 32, start: 1.0, col: 0 },
    { cup: [3, 1], dir: [0, 1], mode: 'pass', over: 0.1, K: 30, start: 1.0, col: 1 },
    { cup: [1, 0], dir: [0, 1], mode: 'slope', reach: 2.2, K: 24, start: 0.8, col: 0 },
    { cup: [1, 3], dir: [0, 1], mode: 'slope', reach: 2.0, K: 22, start: 0.8, col: 3 },
  ],
  dotR: 0.17,          // radius of the newest trail dot (world units)
  lineW: 0.08, lineA: 0.7,  // the faint line joining the dots
  trailGlow: 0.4,      // trail light (kept subtle, so each trail keeps its pearl's colour)
  // Camera (degrees, world units). Azimuth 0 looks along +z.
  target: [0, -0.6, 0.6], dist: 132, elev: 40, azim: -24, fovY: 26, shiftY: 0.06,
  // Lights, as [right, up, toward camera] in the camera's horizontal frame.
  key: [-0.7, 0.62, 0.45], kKey: 1.25,
  fill: [0.85, 0.32, 0.45], kFill: 0.32,
  rim: [0.45, 0.5, -0.85], kRim: 0.55,
  kAmb: 0.24, shadowK: 7,
  floorLight: [0.1, 1, -0.3],     // steeper light from behind, used only for the floor shadow (falls toward the viewer)
  // Finish
  bloom: [0.10, 0.06], bloomT: 0.55, exposure: 1.0,
  toneKnee: 0.62, toneMax: 0.86,   // soft shoulder (linear); see the encode step
  // Palette (sRGB). Navy studio, teal-blue to violet clay, pastel pearls. No greens.
  // studio backdrop shared with the Learned PDE cover (display sRGB; the tone curve is the identity
  // at these levels, so the image edges land on the frame's navy rgb(15, 37, 64))
  bgEdge: '#0f2540', bgMid: '#26386f', bgGlow: '#4a3f8f', bgCore: '#6a5cad',
  glowC: [0.5, 0.42], glowR: [0.6, 0.46], edgeW: 0.2,
  topLow: '#4146a6', topMid: '#6a72cc', topHigh: '#b3a6ea', topPeak: '#efc6e6',
  sideTop: '#978cdb', sideBot: '#2b5fa8', sidePow: 0.6,
  driftWarm: [1.08, 0.97, 0.98], driftCool: [0.86, 0.98, 1.08], // albedo multipliers across the tray
  pearls: ['#ffcfb4', '#fbb0cd', '#dccafe', '#c6dcfc'],
  keyCol: '#fff0e4', fillCol: '#a9c4ff', rimCol: '#f3b6dc', skyCol: '#8ea6ec', bounceCol: '#3a2f7a',
  shadowTint: '#1a1640',
};

const OVR = process.env.COVER_CFG ? JSON.parse(process.env.COVER_CFG) : {};

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
/** Sub-stream seed from the master seed and a few integers. */
function subSeed(...ks) {
  let h = SEED >>> 0;
  for (const k of ks) { h = Math.imul(h ^ (k + 0x9e3779b9), 0x85ebca6b) >>> 0; h = (h ^ (h >>> 13)) >>> 0; h = Math.imul(h, 0xc2b2ae35) >>> 0; h = (h ^ (h >>> 16)) >>> 0; }
  return h;
}
function gaussian(rand) {
  let u = 0; while (u <= 1e-12) u = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

// ---------------------------------------------------------------- scene setup (main thread)
/** Pearls and trails. Returns plain arrays so they can be sent to the workers. */
function buildScene(C) {
  const OX = C.NX * Math.PI, OZ = C.NZ * Math.PI;
  const V = (x, z) => Math.cos(x + OX) + Math.cos(z + OZ);
  const cupX = (i) => (2 * i + 1 - C.NX) * Math.PI, cupZ = (k) => (2 * k + 1 - C.NZ) * Math.PI;
  const h = (x, z) => C.A * V(x, z);
  const pickCol = (u) => { let a = 0; for (let c = 0; c < 4; c++) { a += C.colorW[c]; if (u < a) return c; } return 3; };

  // Movers: Euler-Maruyama from the bottom of a cup until the pearl reaches its pass or slope.
  const sig = Math.sqrt((2 * C.dt) / C.beta);
  const movers = [], trails = [];
  C.movers.forEach((m, mi) => {
    const x0 = cupX(m.cup[0]), z0 = cupZ(m.cup[1]);
    const [sx, sz] = m.dir;
    for (let attempt = 0; attempt < 500; attempt++) {
      const r = mulberry32(subSeed(1000 + mi, attempt));
      let x = x0, z = z0;
      const path = [x, z];
      let ok = false;
      for (let s = 0; s < 40000; s++) {
        x += Math.sin(x + OX) * C.dt + sig * gaussian(r);   // -dV/dx = sin(x + OX)
        z += Math.sin(z + OZ) * C.dt + sig * gaussian(r);   // -dV/dz = sin(z + OZ)
        path.push(x, z);
        const along = (x - x0) * sx + (z - z0) * sz, perp = Math.abs((x - x0) * sz - (z - z0) * sx);
        if (m.mode === 'pass') {
          if (along > Math.PI + m.over && perp < 0.75) { ok = true; break; }
        } else if (along > m.reach - 0.25 && along < m.reach + 0.25 && perp < 0.55) { ok = true; break; }
        // left the cup some other way: reject, try the next sub-seed
        if (Math.abs(x - x0) > Math.PI + 0.3 || Math.abs(z - z0) > Math.PI + 0.3 || (along > Math.PI - 0.3 && perp > 1.2)) break;
      }
      if (!ok) continue;
      const n = path.length / 2, K = Math.min(m.K, n - 1);
      const pts = path.slice(2 * (n - 1 - K));
      // art selection among sample paths: show one whose trail starts down in the cup
      if (Math.hypot(pts[0] - x0, pts[1] - z0) > m.start) continue;
      movers.push({ x, z, col: m.col, fixed: true });
      trails.push({ pts, col: m.col, attempt });
      break;
    }
  });

  // Resting pearls: Boltzmann density exp(-beta V) restricted to each cup, by rejection.
  const rand = mulberry32(subSeed(1));
  const pearls = movers.map((p) => ({ ...p }));
  for (let k = 0; k < C.NZ; k++) for (let i = 0; i < C.NX; i++) {
    let n = C.counts ? C.counts[k * C.NX + i] : 2 + Math.floor(rand() * 4);
    if (C.movers.some((m) => m.cup[0] === i && m.cup[1] === k)) n = Math.min(n, C.srcMax);
    if (C.movers.some((m) => m.mode === 'pass' && m.cup[0] + m.dir[0] === i && m.cup[1] + m.dir[1] === k)) n = Math.min(n, C.dstMax);
    const x0 = cupX(i), z0 = cupZ(k);
    for (let q = 0; q < n; q++) {
      let x, z;
      for (;;) {
        x = x0 + (2 * rand() - 1) * Math.PI; z = z0 + (2 * rand() - 1) * Math.PI;
        if (rand() < Math.exp(-C.beta * (V(x, z) + 2))) break;
      }
      pearls.push({ x, z, col: pickCol(rand()), fixed: false, cx: x0, cz: z0 });
    }
  }
  // Relax: push overlapping pearls apart (in plan), keep them off the trails, let free ones settle a little downhill.
  const minD = 2 * C.R * 1.03;
  const tpts = [];
  for (const t of trails) for (let i = Math.floor(t.pts.length / 2 * 0.15); i < t.pts.length / 2; i++) tpts.push(t.pts[2 * i], t.pts[2 * i + 1]);
  for (let it = 0; it < C.settle; it++) {
    for (const p of pearls) if (!p.fixed) {
      p.x += Math.sin(p.x + OX) * 0.05; p.z += Math.sin(p.z + OZ) * 0.05;
      for (let i = 0; i < tpts.length; i += 2) {
        const dx = p.x - tpts[i], dz = p.z - tpts[i + 1], d = Math.hypot(dx, dz), want = C.R + 0.18;
        if (d < want && d > 1e-9) { p.x += (dx / d) * (want - d) * 0.5; p.z += (dz / d) * (want - d) * 0.5; }
      }
    }
    for (let a = 0; a < pearls.length; a++) for (let b = a + 1; b < pearls.length; b++) {
      const p = pearls[a], q = pearls[b];
      const dx = q.x - p.x, dz = q.z - p.z, d = Math.hypot(dx, dz);
      const need = p.fixed || q.fixed ? minD + C.moverGap : minD;
      if (d >= need || d < 1e-9) continue;
      const push = need - d, ux = dx / d, uz = dz / d;
      const wp = p.fixed ? 0 : q.fixed ? 1 : 0.5, wq = q.fixed ? 0 : p.fixed ? 1 : 0.5;
      p.x -= ux * push * wp; p.z -= uz * push * wp;
      q.x += ux * push * wq; q.z += uz * push * wq;
    }
  }
  // Rest each pearl on the surface: lowest centre height that clears the terrain under it.
  for (const p of pearls) {
    let y = -1e9;
    for (let a = 0; a < 16; a++) for (let rr = 0; rr <= 6; rr++) {
      const r = (rr / 6) * C.R, th = (a / 16) * 2 * Math.PI;
      const xx = p.x + r * Math.cos(th), zz = p.z + r * Math.sin(th);
      y = Math.max(y, h(xx, zz) + Math.sqrt(Math.max(0, C.R * C.R - r * r)));
    }
    p.y = y;
  }
  return { pearls: pearls.map((p) => [p.x, p.y, p.z, p.col]), trails: trails.map((t) => ({ pts: Array.from(t.pts), col: t.col })), attempts: trails.map((t) => t.attempt) };
}

// ---------------------------------------------------------------- renderer (workers)
function makeRenderer(C, scene) {
  const OX = C.NX * Math.PI, OZ = C.NZ * Math.PI, A = C.A;
  const LIP = 1 / Math.sqrt(1 + 2 * A * A);
  const XH = C.NX * Math.PI + C.PAD, ZH = C.NZ * Math.PI + C.PAD;
  const YB = -2 * A - C.T;                 // tray bottom
  const FLOOR = YB - C.GAP;
  const R = C.R;
  const P = scene.pearls;                  // [x, y, z, col]
  const NP = P.length;
  const PX = new Float64Array(NP), PY = new Float64Array(NP), PZ = new Float64Array(NP), PC = new Int32Array(NP);
  let pTop = -1e9;
  for (let i = 0; i < NP; i++) { [PX[i], PY[i], PZ[i], PC[i]] = P[i]; pTop = Math.max(pTop, PY[i] + R); }

  // pearl lookup grid: cells of size 2 pi aligned with the cups, each listing the pearls within M of it
  const CELL = 2 * Math.PI, M = 0.9, GX = C.NX + 2, GZ = C.NZ + 2;
  const gx0 = -C.NX * Math.PI - CELL, gz0 = -C.NZ * Math.PI - CELL;
  const cells = Array.from({ length: GX * GZ }, () => []);
  for (let gi = 0; gi < GX; gi++) for (let gk = 0; gk < GZ; gk++) {
    const ax = gx0 + gi * CELL, az = gz0 + gk * CELL;
    for (let i = 0; i < NP; i++) {
      const dx = Math.max(ax - PX[i], 0, PX[i] - ax - CELL), dz = Math.max(az - PZ[i], 0, PZ[i] - az - CELL);
      if (Math.hypot(dx, dz) < R + M) cells[gk * GX + gi].push(i);
    }
  }
  const cellArr = cells.map((c) => Int32Array.from(c));

  // trails
  const TR = scene.trails.map((t) => {
    const pts = Float64Array.from(t.pts), n = pts.length / 2;
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (let i = 0; i < n; i++) { x0 = Math.min(x0, pts[2 * i]); x1 = Math.max(x1, pts[2 * i]); z0 = Math.min(z0, pts[2 * i + 1]); z1 = Math.max(z1, pts[2 * i + 1]); }
    const m = 0.8;
    return { pts, n, col: t.col, box: [x0 - m, x1 + m, z0 - m, z1 + m] };
  });

  const V = (x, z) => Math.cos(x + OX) + Math.cos(z + OZ);
  const smax = (a, b, k) => { const hh = clamp(0.5 + 0.5 * (a - b) / k, 0, 1); return b + (a - b) * hh + k * hh * (1 - hh); };
  function footprint(x, z) {
    const qx = Math.abs(x) - (XH - C.RC), qz = Math.abs(z) - (ZH - C.RC);
    const ox = qx > 0 ? qx : 0, oz = qz > 0 ? qz : 0;
    return Math.sqrt(ox * ox + oz * oz) + Math.min(Math.max(qx, qz), 0) - C.RC;
  }
  function sdTray(x, y, z) {
    const dTop = (y - A * V(x, z)) * LIP;
    return smax(smax(dTop, footprint(x, z), C.BEVEL), YB - y, C.BEVEL2);
  }
  let HIT = 0, HITP = -1;
  function sdPearls(x, y, z) {
    if (y > pTop + M) { HITP = -1; return y - pTop; }
    const gi = Math.floor((x - gx0) / CELL), gk = Math.floor((z - gz0) / CELL);
    HITP = -1;
    if (gi < 0 || gk < 0 || gi >= GX || gk >= GZ) return M;
    const list = cellArr[gk * GX + gi];
    let best = M;
    for (let j = 0; j < list.length; j++) {
      const i = list[j];
      const d = Math.hypot(x - PX[i], y - PY[i], z - PZ[i]) - R;
      if (d < best) { best = d; HITP = i; }
    }
    return best;
  }
  function sdScene(x, y, z) {
    const a = sdTray(x, y, z), b = sdPearls(x, y, z);
    if (b < a) { HIT = 1; return b; }
    HIT = 0; return a;
  }

  // bounding box of tray + pearls
  const BB = [-XH - 0.1, YB - 0.1, -ZH - 0.1, XH + 0.1, Math.max(2 * A, pTop) + 0.1, ZH + 0.1];
  const span = [0, 0];
  function boxRange(ox, oy, oz, dx, dy, dz) {
    let t0 = 0, t1 = 1e9;
    const o = [ox, oy, oz], d = [dx, dy, dz];
    for (let a = 0; a < 3; a++) {
      if (Math.abs(d[a]) < 1e-12) { if (o[a] < BB[a] || o[a] > BB[a + 3]) return false; continue; }
      let ta = (BB[a] - o[a]) / d[a], tb = (BB[a + 3] - o[a]) / d[a];
      if (ta > tb) { const s = ta; ta = tb; tb = s; }
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
      if (t0 > t1) return false;
    }
    span[0] = t0; span[1] = t1; return true;
  }

  // camera
  const deg = Math.PI / 180;
  const el = C.elev * deg, az = C.azim * deg;
  const T = C.target;
  const EYE = [T[0] - C.dist * Math.cos(el) * Math.sin(az), T[1] + C.dist * Math.sin(el), T[2] - C.dist * Math.cos(el) * Math.cos(az)];
  const FWD = norm([T[0] - EYE[0], T[1] - EYE[1], T[2] - EYE[2]]);
  const RIGHT = norm(cross(FWD, [0, 1, 0]));
  const UP = cross(RIGHT, FWD);
  const FH = norm([FWD[0], 0, FWD[2]]);
  const TY = Math.tan((C.fovY * deg) / 2), TX = (TY * C.W) / C.H;
  const lightDir = (v) => norm([RIGHT[0] * v[0] - FH[0] * v[2], v[1], RIGHT[2] * v[0] - FH[2] * v[2]]);
  const LK = lightDir(C.key), LF = lightDir(C.fill), LR = lightDir(C.rim), FL = lightDir(C.floorLight);

  const col = (k) => hexLin(C[k]);
  const NAVY = col('bgEdge'), BMID = col('bgMid'), GLOW = col('bgGlow'), BCORE = col('bgCore');
  const TOP = [[-2, col('topLow')], [-0.7, col('topMid')], [1.0, col('topHigh')], [2, col('topPeak')]];
  const SIDE_T = col('sideTop'), SIDE_B = col('sideBot');
  // drift axis: from the key-light side of the tray toward the opposite side (in plan)
  const DRX = -LK[0] / Math.hypot(LK[0], LK[2]), DRZ = -LK[2] / Math.hypot(LK[0], LK[2]);
  const WARM = C.driftWarm, COOL = C.driftCool;
  const PCOL = C.pearls.map(hexLin);
  const KEY = col('keyCol'), FILL = col('fillCol'), RIM = col('rimCol'), SKY = col('skyCol'), BOUNCE = col('bounceCol'), STINT = col('shadowTint');

  function rampAt(stops, x, out) {
    if (x <= stops[0][0]) { out[0] = stops[0][1][0]; out[1] = stops[0][1][1]; out[2] = stops[0][1][2]; return out; }
    for (let i = 1; i < stops.length; i++) if (x <= stops[i][0]) {
      const [x0, c0] = stops[i - 1], [x1, c1] = stops[i];
      let t = (x - x0) / (x1 - x0); t = t * t * (3 - 2 * t);
      for (let c = 0; c < 3; c++) out[c] = c0[c] + (c1[c] - c0[c]) * t;
      return out;
    }
    const c = stops[stops.length - 1][1]; out[0] = c[0]; out[1] = c[1]; out[2] = c[2]; return out;
  }

  // studio backdrop (the same one as the Learned PDE cover): an indigo glow behind the subject,
  // easing out through a muted royal blue to MTAN navy, and pure navy along every edge
  function backdrop(u, v, out) {
    const ex = (u - C.glowC[0]) / C.glowR[0], ey = (v - C.glowC[1]) / C.glowR[1];
    const q = Math.sqrt(ex * ex + ey * ey);
    const kCore = 1 - smooth(0, 0.45, q), kGlow = 1 - smooth(0.15, 0.8, q), kMid = 1 - smooth(0.55, 1.25, q);
    const de = Math.min(u, 1 - u, ((v < 0.5 ? v : 1 - v) * C.H) / C.W);
    const kIn = smooth(0, C.edgeW, de);
    for (let c = 0; c < 3; c++) {
      let x = NAVY[c];
      x += (BMID[c] - x) * kMid;
      x += (GLOW[c] - x) * kGlow;
      x += (BCORE[c] - x) * kCore * 0.6;
      out[c] = NAVY[c] + (x - NAVY[c]) * kIn;
    }
    return out;
  }

  function normalAt(x, y, z, out) {
    const e = 0.0015;
    const a = sdScene(x + e, y - e, z - e), b = sdScene(x - e, y - e, z + e);
    const c = sdScene(x - e, y + e, z - e), d = sdScene(x + e, y + e, z + e);
    const nx = a - b - c + d, ny = -a - b + c + d, nz = -a + b - c + d;
    const l = Math.hypot(nx, ny, nz) || 1;
    out[0] = nx / l; out[1] = ny / l; out[2] = nz / l; return out;
  }

  function softShadow(ox, oy, oz, L, k) {
    if (!boxRange(ox, oy, oz, L[0], L[1], L[2])) return 1;
    let res = 1, t = Math.max(0.02, span[0]);
    const tEnd = span[1];
    for (let i = 0; i < 96 && t < tEnd; i++) {
      const hh = sdScene(ox + L[0] * t, oy + L[1] * t, oz + L[2] * t);
      if (hh < 0.0005) return 0;
      res = Math.min(res, (k * hh) / t);
      t += clamp(hh, 0.03, 0.6);
    }
    return smooth(0, 1, clamp(res, 0, 1));
  }

  function ambientOcc(x, y, z, n) {
    let occ = 0, w = 1;
    for (let i = 1; i <= 5; i++) {
      const hh = 0.06 + 0.22 * i;
      const d = sdScene(x + n[0] * hh, y + n[1] * hh, z + n[2] * hh);
      occ += (hh - d) * w; w *= 0.7;
    }
    return clamp(1 - 0.9 * occ, 0, 1);
  }

  // trails painted on the tray top: a dot at every Euler-Maruyama step, joined by a faint line,
  // fading toward the oldest step. Returns [coverage, glow, colour index].
  const TRL = [0, 0, -1];
  function trailAt(x, z) {
    TRL[0] = 0; TRL[1] = 0; TRL[2] = -1;
    for (const t of TR) {
      if (x < t.box[0] || x > t.box[1] || z < t.box[2] || z > t.box[3]) continue;
      const p = t.pts, n = t.n;
      let cov = 0, glow = 0;
      for (let i = 0; i < n - 1; i++) {
        const s = i / (n - 1), fade = 0.3 + 0.7 * Math.pow(s, 1.1);
        const ax = p[2 * i], az = p[2 * i + 1];
        // the dot of step i
        const rd = C.dotR * (0.6 + 0.4 * s);
        const dd = Math.hypot(x - ax, z - az);
        if (dd < rd + 0.5) {
          cov = Math.max(cov, (1 - smooth(rd - 0.03, rd + 0.01, dd)) * fade);
          glow = Math.max(glow, Math.exp(-(dd * dd) / (2 * 0.22 * 0.22)) * fade);
        }
        // the line to step i + 1
        const bx = p[2 * i + 2], bz = p[2 * i + 3];
        const ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez || 1e-12;
        const u = clamp(((x - ax) * ex + (z - az) * ez) / l2, 0, 1);
        const dl = Math.hypot(x - ax - ex * u, z - az - ez * u);
        if (dl < 0.2) cov = Math.max(cov, (1 - smooth(C.lineW * 0.4, C.lineW, dl)) * fade * C.lineA);
      }
      if (cov > TRL[0]) { TRL[0] = cov; TRL[2] = t.col; }
      if (glow > TRL[1]) { TRL[1] = glow; if (TRL[2] < 0) TRL[2] = t.col; }
    }
    return TRL;
  }

  const ALB = [0, 0, 0], A2 = [0, 0, 0];
  function shadeTray(x, y, z, n, rdx, rdy, rdz, out) {
    // albedo: by height on the top, a vertical gradient on the sides
    const top = A * V(x, z);
    rampAt(TOP, top / A, ALB);
    // a gentle drift across the tray: warmer pink-lilac on the key-light side, cooler periwinkle on the far side
    const drift = clamp(0.5 + (x * DRX + z * DRZ) / (2 * Math.hypot(XH, ZH)), 0, 1);
    for (let c = 0; c < 3; c++) ALB[c] *= WARM[c] + (COOL[c] - WARM[c]) * drift;
    const side = Math.max(1 - smooth(0.25, 0.6, n[1]), smooth(0.05, 0.4, top - y));
    if (side > 0) {
      const f = clamp((top - y) / (top - YB), 0, 1);
      const tt = smooth(0, 1, Math.pow(f, C.sidePow));
      for (let c = 0; c < 3; c++) A2[c] = SIDE_T[c] + (SIDE_B[c] - SIDE_T[c]) * tt;
      for (let c = 0; c < 3; c++) ALB[c] += (A2[c] - ALB[c]) * side;
    }
    let tc = 0, th = 0, ti = -1;
    if (side < 0.5) { trailAt(x, z); tc = TRL[0] * (1 - side * 2); th = TRL[1] * (1 - side * 2); ti = TRL[2]; }
    if (ti >= 0 && tc > 0) for (let c = 0; c < 3; c++) ALB[c] += (PCOL[ti][c] - ALB[c]) * tc;

    const ndl = n[0] * LK[0] + n[1] * LK[1] + n[2] * LK[2];
    let sh = 1;
    if (ndl > -0.2) sh = softShadow(x + n[0] * 0.01, y + n[1] * 0.01, z + n[2] * 0.01, LK, C.shadowK);
    const ao = ambientOcc(x, y, z, n);
    const wrap = Math.max(0, (ndl + 0.3) / 1.3);
    const kd = C.kKey * wrap * (0.3 + 0.7 * sh);
    const fl = C.kFill * Math.max(0, (n[0] * LF[0] + n[1] * LF[1] + n[2] * LF[2] + 0.2) / 1.2) * (0.5 + 0.5 * ao);
    const sky = 0.5 + 0.5 * n[1];
    const cosv = clamp(-(n[0] * rdx + n[1] * rdy + n[2] * rdz), 0, 1);
    const rimT = Math.pow(1 - cosv, 3) * Math.max(0, n[0] * LR[0] + n[1] * LR[1] + n[2] * LR[2] + 0.3) * C.kRim * (0.4 + 0.6 * ao);
    const hx = LK[0] - rdx, hy = LK[1] - rdy, hz = LK[2] - rdz, hl = Math.hypot(hx, hy, hz);
    const spec = Math.pow(Math.max(0, (n[0] * hx + n[1] * hy + n[2] * hz) / hl), 28) * 0.07 * sh;
    for (let c = 0; c < 3; c++) {
      const amb = (SKY[c] * sky + BOUNCE[c] * (1 - sky)) * C.kAmb * ao;
      out[c] = ALB[c] * (KEY[c] * kd + FILL[c] * fl + amb) + RIM[c] * rimT + KEY[c] * spec;
    }
    if (ti >= 0) {
      const e = C.trailGlow * (tc * 0.6 + th * 0.14);
      for (let c = 0; c < 3; c++) out[c] += PCOL[ti][c] * e;
    }
    return out;
  }

  // what the pearls see in reflections: the navy-indigo studio, the key softbox, the rim softbox, the tray below
  const TRAYREF = hexLin('#5b5fb8');
  function envColor(dx, dy, dz, out) {
    const up = clamp(dy, -1, 1);
    for (let c = 0; c < 3; c++) out[c] = up > 0 ? GLOW[c] + (NAVY[c] - GLOW[c]) * Math.pow(up, 0.7) : GLOW[c] + (TRAYREF[c] * 0.6 - GLOW[c]) * smooth(0, 0.25, -up);
    const ck = dx * LK[0] + dy * LK[1] + dz * LK[2];
    const sk = smooth(0.94, 0.985, ck) * 4.0 + smooth(0.55, 1, ck) * 0.18;
    const cr = dx * LR[0] + dy * LR[1] + dz * LR[2];
    const sr = smooth(0.86, 0.97, cr) * 1.4;
    for (let c = 0; c < 3; c++) out[c] += KEY[c] * sk + RIM[c] * sr;
    return out;
  }

  const ENV = [0, 0, 0];
  function shadePearl(i, x, y, z, n, rdx, rdy, rdz, out) {
    const pc = PCOL[PC[i]];
    const cosv = clamp(-(n[0] * rdx + n[1] * rdy + n[2] * rdz), 0, 1);
    const F = 0.045 + 0.955 * Math.pow(1 - cosv, 5);
    const rdn = rdx * n[0] + rdy * n[1] + rdz * n[2];
    envColor(rdx - 2 * rdn * n[0], rdy - 2 * rdn * n[1], rdz - 2 * rdn * n[2], ENV);
    const ndl = n[0] * LK[0] + n[1] * LK[1] + n[2] * LK[2];
    const sh = ndl > -0.15 ? softShadow(x + n[0] * 0.01, y + n[1] * 0.01, z + n[2] * 0.01, LK, C.shadowK) : 0;
    const ao = ambientOcc(x, y, z, n);
    const wrap = Math.max(0, (ndl + 0.35) / 1.35);
    const kd = C.kKey * 0.85 * wrap * (0.45 + 0.55 * sh);
    const fl = C.kFill * Math.max(0, (n[0] * LF[0] + n[1] * LF[1] + n[2] * LF[2] + 0.2) / 1.2);
    const sky = 0.5 + 0.5 * n[1];
    const rimT = Math.pow(1 - cosv, 2.5) * Math.max(0, n[0] * LR[0] + n[1] * LR[1] + n[2] * LR[2] + 0.35) * C.kRim * 1.1;
    const hx = LK[0] - rdx, hy = LK[1] - rdy, hz = LK[2] - rdz, hl = Math.hypot(hx, hy, hz);
    const nh = Math.max(0, (n[0] * hx + n[1] * hy + n[2] * hz) / hl);
    const sp = (Math.pow(nh, 220) * 1.6 + Math.pow(nh, 24) * 0.08) * sh;
    for (let c = 0; c < 3; c++) {
      const amb = (SKY[c] * sky + BOUNCE[c] * (1 - sky)) * C.kAmb * 1.35 * (0.4 + 0.6 * ao);
      const body = pc[c] * (KEY[c] * kd + FILL[c] * fl + amb) + pc[c] * RIM[c] * rimT;
      out[c] = body * (1 - F) + ENV[c] * F * (0.35 + 0.65 * ao) + KEY[c] * sp;
    }
    return out;
  }

  // floor: a shadow catcher in the backdrop colour, with a soft shadow under the floating tray
  function shadeFloor(x, z, u, v, out) {
    backdrop(u, v, out);
    const lift = -FLOOR + YB;
    const sx = x + (FL[0] / FL[1]) * lift, sz = z + (FL[2] / FL[1]) * lift;
    const d = footprint(sx, sz);
    const s = 0.55 * (1 - smooth(-4.0, 6.5, d)) + 0.35 * (1 - smooth(-2.5, 1.5, d));
    // shadows lean deep indigo, never black
    for (let c = 0; c < 3; c++) out[c] = out[c] * (1 - s) + Math.min(out[c], STINT[c]) * s;
    return out;
  }

  const N = [0, 0, 0];
  function march(ox, oy, oz, dx, dy, dz) {
    if (!boxRange(ox, oy, oz, dx, dy, dz)) return -1;
    let t = span[0];
    const tEnd = span[1];
    for (let i = 0; i < 400 && t <= tEnd; i++) {
      const d = sdScene(ox + dx * t, oy + dy * t, oz + dz * t);
      if (d < 0.00012 * t) return t;
      t += d;
    }
    return -1;
  }

  function samplePixel(sx, sy, out) {
    const u = sx / C.W, v = sy / C.H;
    const px = (2 * u - 1) * TX, py = (1 - 2 * v + C.shiftY) * TY;
    let dx = FWD[0] + RIGHT[0] * px + UP[0] * py;
    let dy = FWD[1] + RIGHT[1] * px + UP[1] * py;
    let dz = FWD[2] + RIGHT[2] * px + UP[2] * py;
    const l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
    const t = march(EYE[0], EYE[1], EYE[2], dx, dy, dz);
    if (t > 0) {
      const x = EYE[0] + dx * t, y = EYE[1] + dy * t, z = EYE[2] + dz * t;
      sdScene(x, y, z);
      const hit = HIT, hp = HITP;
      normalAt(x, y, z, N);
      if (hit === 1 && hp >= 0) return shadePearl(hp, x, y, z, N, dx, dy, dz, out);
      return shadeTray(x, y, z, N, dx, dy, dz, out);
    }
    if (dy < 0) {
      const tf = (FLOOR - EYE[1]) / dy;
      return shadeFloor(EYE[0] + dx * tf, EYE[2] + dz * tf, u, v, out);
    }
    return backdrop(u, v, out);
  }

  function project(x, y, z) {
    const rx = x - EYE[0], ry = y - EYE[1], rz = z - EYE[2];
    const zc = rx * FWD[0] + ry * FWD[1] + rz * FWD[2];
    const xc = rx * RIGHT[0] + ry * RIGHT[1] + rz * RIGHT[2], yc = rx * UP[0] + ry * UP[1] + rz * UP[2];
    return [((xc / zc / TX + 1) / 2) * C.W, ((1 + C.shiftY - yc / zc / TY) / 2) * C.H];
  }
  return { samplePixel, EYE, project };
}

// ---------------------------------------------------------------- post (main thread)
function boxBlur(src, W, H, r) {
  const out = new Float32Array(src.length), tmp = new Float32Array(src.length);
  const pass = (a, b, horiz) => {
    const n = horiz ? W : H, m = horiz ? H : W, st = horiz ? 3 : 3 * W, ls = horiz ? 3 * W : 3;
    for (let line = 0; line < m; line++) for (let c = 0; c < 3; c++) {
      const base = line * ls + c; let acc = 0;
      for (let i = -r; i <= r; i++) acc += a[base + clamp(i, 0, n - 1) * st];
      for (let i = 0; i < n; i++) {
        b[base + i * st] = acc / (2 * r + 1);
        acc += a[base + Math.min(n - 1, i + r + 1) * st] - a[base + Math.max(0, i - r) * st];
      }
    }
  };
  pass(src, tmp, true); pass(tmp, out, false);
  return out;
}
function gaussBlur(src, W, H, sigma) { const r = Math.max(1, Math.round(sigma * 0.85)); let a = src; for (let i = 0; i < 3; i++) a = boxBlur(a, W, H, r); return a; }

// ---------------------------------------------------------------- main / workers
if (!isMainThread) {
  const { C, scene, rows, offs } = workerData;
  const R = makeRenderer(C, scene);
  const out = new Float32Array(rows.length * C.W * 3);
  const px = [0, 0, 0];
  const ns = offs.length / 2;
  rows.forEach((row, k) => {
    for (let colI = 0; colI < C.W; colI++) {
      let r = 0, g = 0, b = 0;
      for (let s = 0; s < offs.length; s += 2) {
        R.samplePixel(colI + offs[s], row + offs[s + 1], px);
        r += px[0]; g += px[1]; b += px[2];
      }
      const o = (k * C.W + colI) * 3;
      out[o] = r / ns; out[o + 1] = g / ns; out[o + 2] = b / ns;
    }
  });
  parentPort.postMessage(out, [out.buffer]);
} else {
  const scale = Number(process.env.COVER_SCALE ?? 1);
  const C = { ...BASE_CFG, ...OVR };
  C.W = Math.round(C.W * scale); C.H = Math.round(C.H * scale);
  if (process.env.COVER_SS) C.ss = +process.env.COVER_SS;
  const outPath = resolve(process.env.COVER_OUT || DEFAULT_OUT);
  const t0 = Date.now();
  const scene = buildScene(C);
  if (process.env.COVER_DEBUG) {
    const Rm = makeRenderer(C, scene);
    scene.pearls.slice(0, scene.trails.length).forEach((p, i) => console.log('mover', i, 'screen', Rm.project(p[0], p[1], p[2]).map((v) => Math.round(v)).join(','), 'trail start', Rm.project(scene.trails[i].pts[0], p[1], scene.trails[i].pts[1]).map((v) => Math.round(v)).join(',')));
  }
  // world units scale with the image: keep the scene, the camera and the pixel pattern fixed
  const rs = mulberry32(subSeed(2));
  const offs = [];
  for (let j = 0; j < C.ss; j++) for (let i = 0; i < C.ss; i++) offs.push((i + 0.3 + 0.4 * rs()) / C.ss, (j + 0.3 + 0.4 * rs()) / C.ss);
  const nW = Math.max(1, Math.min(16, (os.availableParallelism?.() ?? os.cpus().length) - 1));
  const assign = Array.from({ length: nW }, () => []);
  for (let row = 0; row < C.H; row++) assign[row % nW].push(row);
  const lin = new Float32Array(C.W * C.H * 3);
  await Promise.all(assign.map((rows) => new Promise((res, rej) => {
    const w = new Worker(new URL(import.meta.url), { workerData: { C, scene, rows, offs } });
    w.once('message', (data) => { rows.forEach((row, k) => lin.set(data.subarray(k * C.W * 3, (k + 1) * C.W * 3), row * C.W * 3)); res(); });
    w.once('error', rej);
  })));
  const t1 = Date.now();

  // faint bloom from the brightest parts only (pearl highlights, the trails)
  const bright = new Float32Array(lin.length);
  for (let i = 0; i < lin.length; i += 3) {
    const l = 0.2126 * lin[i] + 0.7152 * lin[i + 1] + 0.0722 * lin[i + 2];
    const k = Math.max(0, l - C.bloomT) / Math.max(l, 1e-6);
    bright[i] = lin[i] * k; bright[i + 1] = lin[i + 1] * k; bright[i + 2] = lin[i + 2] * k;
  }
  const b1 = gaussBlur(bright, C.W, C.H, 4 * scale), b2 = gaussBlur(bright, C.W, C.H, 22 * scale);
  // soft shoulder: linear up to KNEE, then eases toward MAXV (about 242 in sRGB), which leaves
  // room for WebP's ringing around the pearl highlights, so no decoded channel reaches 255
  const KNEE = C.toneKnee, MAXV = C.toneMax;
  const shoulder = (x) => (x < KNEE ? x : KNEE + (MAXV - KNEE) * (1 - Math.exp(-(x - KNEE) / (MAXV - KNEE))));
  const rand = mulberry32(subSeed(3));
  const px = Buffer.alloc(C.W * C.H * 3);
  let maxV = 0;
  for (let i = 0; i < lin.length; i++) {
    let v = (lin[i] + C.bloom[0] * b1[i] + C.bloom[1] * b2[i]) * C.exposure;
    v = shoulder(Math.max(0, v));
    const q = clamp(Math.round(l2s(v) * 255 + rand() - 0.5), 0, 254);
    px[i] = q; if (q > maxV) maxV = q;
  }
  mkdirSync(dirname(outPath), { recursive: true });
  let info, guardPasses = 0, guarded = 0;
  if (outPath.endsWith('.png')) {
    info = await sharp(px, { raw: { width: C.W, height: C.H, channels: 3 } }).png({ compressionLevel: 9 }).toFile(outPath);
  } else {
    // Highlight guard: lossy WebP (4:2:0 chroma, ringing) can push a small saturated highlight
    // 20+ levels above its source value. Encode, decode, and wherever a decoded channel reaches
    // 254, darken the source by 4% in a 5 x 5 window; repeat until the decoded image stays below 254.
    const enc = () => sharp(px, { raw: { width: C.W, height: C.H, channels: 3 } }).webp({ quality: C.quality, effort: 6, smartSubsample: true }).toBuffer();
    let buf = await enc();
    for (; guardPasses < 10; guardPasses++) {
      const dec = await sharp(buf).raw().toBuffer();
      const hot = [];
      for (let p = 0; p < C.W * C.H; p++) if (dec[3 * p] >= 254 || dec[3 * p + 1] >= 254 || dec[3 * p + 2] >= 254) hot.push(p);
      if (!hot.length) break;
      const mark = new Uint8Array(C.W * C.H);
      for (const p of hot) {
        const x0 = p % C.W, y0 = (p - x0) / C.W;
        for (let y = Math.max(0, y0 - 2); y <= Math.min(C.H - 1, y0 + 2); y++) for (let x = Math.max(0, x0 - 2); x <= Math.min(C.W - 1, x0 + 2); x++) mark[y * C.W + x] = 1;
      }
      for (let p = 0; p < C.W * C.H; p++) if (mark[p]) { guarded++; for (let c = 0; c < 3; c++) px[3 * p + c] = Math.round(px[3 * p + c] * 0.96); }
      buf = await enc();
    }
    writeFileSync(outPath, buf);
    info = { size: buf.length };
  }
  console.log(`${outPath}  ${C.W}x${C.H}  ${(info.size / 1024).toFixed(1)} KB  trace ${((t1 - t0) / 1000).toFixed(1)} s  total ${((Date.now() - t0) / 1000).toFixed(1)} s  (${nW} workers, ss=${C.ss}, ${scene.pearls.length} pearls, mover attempts ${scene.attempts.join(',')}, max ${maxV}, guard passes ${guardPasses} / ${guarded} px)`);
}
