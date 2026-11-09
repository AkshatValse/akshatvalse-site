// Cover artwork for /research/agent-reliability (the "kaleido" colour theme).
// Run from the site root:  node scripts/cover-art/agent-reliability.mjs [out.webp]
// Writes public/research/agent-reliability/cover-art.webp (1200 x 1600, opaque)
// by default; PNG_OUT=<file.png> also writes a lossless copy for inspection.
//
// What it shows: four soft, toy-like stopwatches floating over a pastel
// backdrop (sky blue below, pink-lilac above, the Kaleido card's colours).
// Three small ones are fine: two have finished (full ring and a tick) and one
// is still running (ring part filled, hand moving). The big cream one in front
// has stalled part way round its ring, and a smooth pink circular arrow wraps
// around it, ending at twelve o'clock. Layman reading: "a stalled run, and the
// option of restarting it" (the page's open question; the cover takes no side).
// The ring fractions (0.38 stalled, 0.62 running) are arbitrary; nothing
// about the project's method or results.
//
// Math: none from the project. The shapes are signed distance fields (rounded
// cylinders, capped arcs, capsules, a rounded triangular prism, joined with
// polynomial smooth min/max); the restart arrow is a tube along a 248-degree
// arc whose radius tapers smoothly from tail to head. Rendering: sphere
// tracing; normals from the SDF gradient; wrapped-Lambert key light with SDF
// soft shadows (penumbra estimate min k*h/t), sky/bounce ambient with SDF
// ambient occlusion, Blinn-Phong specular with Schlick Fresnel, and a rim
// term. The floor is the plane y = 0, shaded with the same soft shadows; its
// colour is a vertical gradient whose stops are blended with normalised
// Gaussian weights (smooth, no Mach bands at the stops). One sample per pixel
// first, then a jittered 4 x 4 grid on every pixel at an edge. Rows are split
// over worker threads; each pixel is a pure function of its coordinates, so
// the output does not depend on the number of threads.
//
// Deterministic: the only randomness (sub-pixel jitter and a +-0.5 LSB dither
// before 8-bit quantisation) comes from mulberry32 seeded with SEED (below)
// hashed with the pixel index.

import os from 'node:os';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker, isMainThread, parentPort } from 'node:worker_threads';

const SEED = 0x5a7c0de5;
const OUT = join(dirname(fileURLToPath(import.meta.url)), '../../public/research/agent-reliability/cover-art.webp');

export const CFG = {
  W: 1200, H: 1600,
  quality: 84,
  aaSamples: 4,          // AA grid is aaSamples x aaSamples on edge pixels
  edgeLum: 0.03,         // linear luminance step that marks a pixel as an edge
  exposure: 1.0,
  camera: { pos: [0, 8.0, 10.4], target: [0, 1.75, 0], fovY: 34 },
  // light directions point TOWARD the light
  key: { dir: [-0.6, 0.85, 0.32], col: [1.0, 0.95, 0.87], k: 7 },
  fill: { dir: [0.8, 0.3, 0.5], col: [0.42, 0.38, 0.48] },
  sky: [0.34, 0.36, 0.48],         // ambient from above
  bounce: [0.26, 0.3, 0.4],        // ambient from below
  rim: '#e2cdf4',                  // lilac rim light on grazing edges
  // backdrop: the floor's albedo is an art-directed gradient in screen height
  // in the Kaleido card's colours, sky blue below and pink-lilac on top, lit by
  // a soft pool of light behind the hero. Stops are blended with normalised
  // Gaussian weights (width stopSigma): no flat spots, so no Mach bands.
  // (A cream corner was tried and dropped: cream and sky blue mix to grey.)
  floorStops: [[0, '#88c3e6'], [0.45, '#abd4ec'], [1, '#eccce6']],
  stopSigma: 0.26,
  pool: { x: 0.6, z: -0.8, r: 5.5, gain: 0.16 },
  floorShadowK: 3.2,              // penumbra of the key shadow on the floor (smaller = softer)
  floorShadow: [0.5, 0.4],        // weights of the key shadow and the overhead (contact) shadow
  satShadow: 0.3,                 // the small watches float high: their floor shadows are kept faint
  shadowMul: [0.5, 0.58, 0.78],   // floor colour multiplier under full shadow (cool)
};

// ---- colours -----------------------------------------------------------------
const lin = (h) => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
};

// part ids
const BODY = 1, FACE = 2, TRACK = 3, PROG = 4, HAND = 5, ARROW = 6, CROWN = 7, TICK = 8;

// palettes: body, face, track, progress, hand (navy), crown
const PAL = {
  hero:  { body: '#fff6e2', face: '#0f2540', track: '#24395a', prog: '#e1c4f4', hand: '#fff4d6', crown: '#f8c7d8', arrow: '#f2b3ca', arrowTail: '#d9bdf0' },
  sky:   { body: '#9bd4e5', face: '#fffaf0', track: '#d5e8f3', prog: '#5fa9d4', hand: '#0f2540', crown: '#fff4d6' },
  pink:  { body: '#f8c7d8', face: '#fffaf0', track: '#d5e8f3', prog: '#5fa9d4', hand: '#0f2540', crown: '#fff4d6' },
  cream: { body: '#fff3df', face: '#fffaf0', track: '#d5e8f3', prog: '#5fa9d4', hand: '#0f2540', crown: '#f8c7d8' },
  lilac: { body: '#e1c4f4', face: '#fffaf0', track: '#f6dbe6', prog: '#f8c7d8', hand: '#0f2540', crown: '#fff4d6' },
};

// ---- scene -----------------------------------------------------------------
// kind: 0 stalled (hero, with arrow), 1 running, 2 finished
const D2R = Math.PI / 180;
const OBJECTS = [
  { name: 'hero', c: [0, 2.0, 0.3], s: 1.0, yaw: -14, pitch: -24, roll: 0, kind: 0, frac: 0.38, pal: 'hero', br: 1.75 },
  { name: 'done-left', c: [-2.0, 2.8, -4.4], s: 0.6, yaw: 22, pitch: -26, roll: 8, kind: 2, frac: 1, pal: 'sky', br: 0.6 * 1.4 },
  { name: 'running-right', c: [1.8, 3.0, -2.45], s: 0.5, yaw: -26, pitch: -24, roll: -10, kind: 1, frac: 0.62, pal: 'cream', br: 0.5 * 1.4 },
  { name: 'done-low', c: [-1.35, 1.1, 2.8], s: 0.38, yaw: 26, pitch: -32, roll: -8, kind: 2, frac: 1, pal: 'lilac', br: 0.38 * 1.4 },
];

function rotMat(yaw, pitch, roll) {
  // local -> world: R = Ry(yaw) * Rx(pitch) * Rz(roll)
  const cy = Math.cos(yaw * D2R), sy = Math.sin(yaw * D2R);
  const cx = Math.cos(pitch * D2R), sx = Math.sin(pitch * D2R);
  const cz = Math.cos(roll * D2R), sz = Math.sin(roll * D2R);
  const Ry = [cy, 0, sy, 0, 1, 0, -sy, 0, cy];
  const Rx = [1, 0, 0, 0, cx, -sx, 0, sx, cx];
  const Rz = [cz, -sz, 0, sz, cz, 0, 0, 0, 1];
  const mul = (A, B) => {
    const C = new Array(9).fill(0);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) C[i * 3 + j] += A[i * 3 + k] * B[k * 3 + j];
    return C;
  };
  return mul(mul(Ry, Rx), Rz);
}

const OB = OBJECTS.map((o) => {
  const R = rotMat(o.yaw, o.pitch, o.roll);
  const p = PAL[o.pal];
  const pal = {};
  for (const k of Object.keys(p)) pal[k] = lin(p[k]);
  // progress arc: starts at 12 o'clock, runs clockwise for frac of a turn
  const half = Math.min(o.frac, 0.9999) * Math.PI;
  return { ...o, R, pal, cx: o.c[0], cy: o.c[1], cz: o.c[2], arcRot: half, arcS: Math.sin(half), arcC: Math.cos(half), handA: o.frac * 2 * Math.PI };
});

// ---- SDF primitives ------------------------------------------------------------
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
function smin(a, b, k) { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; }
function smax(a, b, k) { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.max(a, b) + h * h * k * 0.25; }
// rounded cylinder, axis z
function rcylZ(x, y, z, r, h, rr) {
  const qx = Math.sqrt(x * x + y * y) - r + rr, qy = Math.abs(z) - h + rr;
  const ax = qx > 0 ? qx : 0, ay = qy > 0 ? qy : 0;
  return Math.min(Math.max(qx, qy), 0) + Math.sqrt(ax * ax + ay * ay) - rr;
}
// rounded cylinder, axis y
function rcylY(x, y, z, r, h, rr) { return rcylZ(x, z, y, r, h, rr); }
// capsule in 3D
function capsule(x, y, z, ax, ay, az, bx, by, bz, r) {
  const pax = x - ax, pay = y - ay, paz = z - az, bax = bx - ax, bay = by - ay, baz = bz - az;
  const h = clamp((pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz), 0, 1);
  const dx = pax - bax * h, dy = pay - bay * h, dz = paz - baz * h;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - r;
}
// extrude a 2D distance d2 along z with half-height h and rounding rr
function extrude(d2, z, h, rr) {
  const wx = d2, wy = Math.abs(z) - h;
  const ax = wx > 0 ? wx : 0, ay = wy > 0 ? wy : 0;
  return Math.min(Math.max(wx, wy), 0) + Math.sqrt(ax * ax + ay * ay) - rr;
}
// iq's isosceles triangle, apex at origin, base at y = qy
function triIso(px, py, qx, qy) {
  px = Math.abs(px);
  const t = clamp((px * qx + py * qy) / (qx * qx + qy * qy), 0, 1);
  const ax = px - qx * t, ay = py - qy * t;
  const u = clamp(px / qx, 0, 1);
  const bx = px - qx * u, by = py - qy;
  const s = -Math.sign(qy);
  const d1 = Math.min(ax * ax + ay * ay, bx * bx + by * by);
  const d2 = Math.min(s * (px * qy - py * qx), s * (py - qy));
  return -Math.sqrt(d1) * Math.sign(d2);
}

// ---- stopwatch in local units (body radius 1, face toward +z) ------------------
const ZF = 0.17;            // face plane
const RF = 0.78;            // face radius
const RT = 0.555;           // ring radius
const TW = 0.085;           // ring half-width
let PART = 0;

// restart arrow geometry (hero only)
const ARR = { R: 1.42, z: 0.02, aT: 48 * D2R, aH: 296 * D2R, r0: 0.05, r1: 0.125 };
const aHs = Math.sin(ARR.aH), aHc = Math.cos(ARR.aH);

function sdWatch(x, y, z, o) {
  const r = Math.sqrt(x * x + y * y);
  // body with a recessed face
  let d = rcylZ(x, y, z, 1.0, 0.27, 0.15);
  const qx = r - RF, qz = ZF - z;
  const rec = Math.min(Math.max(qx, qz), 0) + Math.sqrt((qx > 0 ? qx * qx : 0) + (qz > 0 ? qz * qz : 0));
  d = smax(d, -rec, 0.05);
  PART = BODY;
  // crown: stem + cap on top
  let c = Math.min(
    rcylY(x, y - 1.04, z, 0.075, 0.1, 0.02),
    rcylY(x, y - 1.2, z, 0.2, 0.075, 0.055),
  );
  // pusher at 45 degrees clockwise from the top
  {
    const a = 45 * D2R, ca = Math.cos(a), sa = Math.sin(a);
    const px = x * ca - y * sa, py = x * sa + y * ca;
    c = Math.min(c, rcylY(px, py - 1.03, z, 0.055, 0.09, 0.02), rcylY(px, py - 1.12, z, 0.11, 0.05, 0.04));
  }
  if (c < d) PART = CROWN;
  d = smin(d, c, 0.04);

  // ring track (shallow) and progress arc (raised pill)
  const zr = z - ZF;
  const trk = extrude(Math.abs(r - RT) - TW + 0.015, zr, 0.012, 0.015);
  if (trk < d) { d = trk; PART = TRACK; }
  if (o.frac > 0) {
    // rotate so the arc's midpoint lies on +y (arc runs clockwise from 12 o'clock)
    const ca = Math.cos(o.arcRot), sa = Math.sin(o.arcRot);
    let px = x * ca - y * sa;
    const py = x * sa + y * ca;
    px = Math.abs(px);
    let d2;
    if (o.frac >= 1) d2 = Math.abs(r - RT);
    else d2 = (o.arcC * px > o.arcS * py) ? Math.sqrt((px - o.arcS * RT) ** 2 + (py - o.arcC * RT) ** 2) : Math.abs(r - RT);
    const pr = extrude(d2 - TW + 0.045, zr - 0.035, 0.0, 0.045);
    if (pr < d) { d = pr; PART = PROG; }
  }
  // centre: hand + hub, or a tick for finished
  if (o.kind === 2) {
    const zc = ZF + 0.05;
    const ck = Math.min(
      capsule(x, y, z, -0.25, 0.0, zc, -0.075, -0.17, zc, 0.068),
      capsule(x, y, z, -0.075, -0.17, zc, 0.26, 0.2, zc, 0.068),
    );
    if (ck < d) { d = ck; PART = HAND; }
  } else {
    const zc = ZF + 0.06;
    const hx = Math.sin(o.handA) * 0.47, hy = Math.cos(o.handA) * 0.47;
    let h = capsule(x, y, z, 0, 0, zc, hx, hy, zc, 0.034);
    h = smin(h, rcylZ(x, y, z - (ZF + 0.045), 0.085, 0.04, 0.035), 0.02);
    if (h < d) { d = h; PART = HAND; }
    // four small tick dots at 12, 3, 6, 9 on the hero
    if (o.kind === 0) {
      const ax = Math.abs(x), ay = Math.abs(y);
      const tx = Math.max(ax, ay) - 0.69, ty = Math.min(ax, ay);
      const tk = Math.sqrt(tx * tx + ty * ty + (z - ZF) * (z - ZF)) - 0.032;
      if (tk < d) { d = tk; PART = TICK; }
    }
  }
  // restart arrow around the hero
  if (o.kind === 0) {
    let a = Math.atan2(x, y);              // clockwise from 12 o'clock
    if (a < 0) a += 2 * Math.PI;
    // tail-side: points past the head wrap into the gap; clamp to the arc
    let ac;
    if (a >= ARR.aT && a <= ARR.aH) ac = a;
    else {
      // nearest end in angle
      const dT = a < ARR.aT ? ARR.aT - a : ARR.aT + 2 * Math.PI - a;
      const dH = a > ARR.aH ? a - ARR.aH : a + 2 * Math.PI - ARR.aH;
      ac = dT < dH ? ARR.aT : ARR.aH;
    }
    const u = (ac - ARR.aT) / (ARR.aH - ARR.aT);
    const s = u * u * (3 - 2 * u);
    const tr = ARR.r0 + (ARR.r1 - ARR.r0) * Math.sqrt(s);
    const ex = x - Math.sin(ac) * ARR.R, ey = y - Math.cos(ac) * ARR.R, ez = z - ARR.z;
    let ad = Math.sqrt(ex * ex + ey * ey + ez * ez) - tr;
    // arrowhead: rounded triangular prism, tangent to the arc at the head end
    const Qx = aHs * ARR.R, Qy = aHc * ARR.R;
    const Tx = aHc, Ty = -aHs;             // clockwise tangent
    const Nx = aHs, Ny = aHc;              // outward normal
    const vx = x - Qx, vy = y - Qy;
    const along = vx * Tx + vy * Ty, rad = vx * Nx + vy * Ny;
    const tip = 0.4;
    const t2 = triIso(rad, tip - along, 0.2, 0.34) - 0.06;
    const head = extrude(t2, ez, 0.035, 0.095);
    ad = smin(ad, head, 0.1);
    if (ad < d) { d = ad; PART = ARROW; }
  }
  return d;
}

// ---- scene SDF -------------------------------------------------------------------
let OBJ = -1;
// EXACT: evaluate every object's full SDF (soft shadows need true distances,
// not the bounding-sphere lower bound, or the penumbra traces the spheres)
let EXACT = false;
// ACTIVE: bitmask of the objects map() sees (the floor weighs the hero's
// shadow and the small watches' shadows separately)
let ACTIVE = ~0;
function map(x, y, z) {
  let d = 1e9;
  OBJ = -1;
  let part = 0;
  for (let i = 0; i < OB.length; i++) {
    if (!(ACTIVE & (1 << i))) continue;
    const o = OB[i];
    const dx = x - o.cx, dy = y - o.cy, dz = z - o.cz;
    const db = Math.sqrt(dx * dx + dy * dy + dz * dz) - o.br;
    if (!EXACT) {
      if (db >= d) continue;
      if (db > 0.3) { d = db; continue; }
    }
    const R = o.R, is = 1 / o.s;
    // world -> local: R^T (p - c) / s
    const lx = (R[0] * dx + R[3] * dy + R[6] * dz) * is;
    const ly = (R[1] * dx + R[4] * dy + R[7] * dz) * is;
    const lz = (R[2] * dx + R[5] * dy + R[8] * dz) * is;
    const dl = sdWatch(lx, ly, lz, o) * o.s;
    if (dl < d) { d = dl; OBJ = i; part = PART; }
  }
  PART = part;
  return d;
}

// ---- camera ----------------------------------------------------------------------
function norm3(v) { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
const CAM = (() => {
  const { pos, target, fovY } = CFG.camera;
  const f = norm3([target[0] - pos[0], target[1] - pos[1], target[2] - pos[2]]);
  const r = norm3(cross(f, [0, 1, 0]));
  const u = cross(r, f);
  return { pos, f, r, u, th: Math.tan((fovY * D2R) / 2), aspect: CFG.W / CFG.H };
})();
const KEY = norm3(CFG.key.dir), FILL = norm3(CFG.fill.dir);

// ---- ray marching ------------------------------------------------------------------
function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = ox - cx, ly = oy - cy, lz = oz - cz;
  const b = lx * dx + ly * dy + lz * dz;
  const c = lx * lx + ly * ly + lz * lz - r * r;
  const h = b * b - c;
  if (h < 0) return null;
  const s = Math.sqrt(h);
  return [-b - s, -b + s];
}

function march(ox, oy, oz, dx, dy, dz) {
  let t0 = Infinity, t1 = -Infinity;
  for (const o of OB) {
    const hit = raySphere(ox, oy, oz, dx, dy, dz, o.cx, o.cy, o.cz, o.br + 0.02);
    if (hit) { if (hit[0] < t0) t0 = hit[0]; if (hit[1] > t1) t1 = hit[1]; }
  }
  if (t0 === Infinity) return -1;
  let t = Math.max(t0, 0);
  for (let i = 0; i < 400 && t < t1; i++) {
    const d = map(ox + dx * t, oy + dy * t, oz + dz * t);
    if (d < 0.00008 * t) return t;
    t += d * 0.85;
  }
  return -1;
}

function softShadow(ox, oy, oz, dx, dy, dz, k, tmax) {
  // quick reject: does the ray pass near any bounding sphere?
  let near = false;
  for (let i = 0; i < OB.length; i++) {
    if (!(ACTIVE & (1 << i))) continue;
    const o = OB[i];
    const lx = o.cx - ox, ly = o.cy - oy, lz = o.cz - oz;
    const b = lx * dx + ly * dy + lz * dz;
    const px = lx - dx * b, py = ly - dy * b, pz = lz - dz * b;
    const dist = Math.sqrt(px * px + py * py + pz * pz);
    if (b > -o.br && dist < o.br + 2.5 * Math.max(b, 0) / k + 0.3) { near = true; break; }
  }
  if (!near) return 1;
  EXACT = true;
  let res = 1, t = 0.015;
  for (let i = 0; i < 120 && t < tmax; i++) {
    const h = map(ox + dx * t, oy + dy * t, oz + dz * t);
    if (h < 0.0002) { res = 0; break; }
    res = Math.min(res, (k * h) / t);
    t += clamp(h, 0.01, 0.35);
  }
  EXACT = false;
  res = clamp(res, 0, 1);
  return res * res * (3 - 2 * res);
}

function calcAO(px, py, pz, nx, ny, nz) {
  let occ = 0, sca = 1;
  for (let i = 0; i < 5; i++) {
    const h = 0.02 + 0.09 * i;
    const d = map(px + nx * h, py + ny * h, pz + nz * h);
    occ += (h - d) * sca;
    sca *= 0.8;
  }
  return clamp(1 - 1.6 * occ, 0.15, 1);
}

function normalAt(x, y, z) {
  const e = 0.0012;
  const a = map(x + e, y - e, z - e), b = map(x - e, y - e, z + e), c = map(x - e, y + e, z - e), d = map(x + e, y + e, z + e);
  const nx = a - b - c + d, ny = -a - b + c + d, nz = -a + b - c + d;
  const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
  return [nx / l, ny / l, nz / l];
}

const C = {
  stops: CFG.floorStops.map(([t, h]) => [t, lin(h)]), rim: lin(CFG.rim),
};
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

function backdrop(v) {
  // v: 0 at the bottom of the image, 1 at the top
  const S = C.stops;
  let wsum = 0;
  const c = [0, 0, 0];
  for (const [t, col] of S) {
    const w = Math.exp(-(((v - t) / CFG.stopSigma) ** 2));
    wsum += w;
    c[0] += w * col[0]; c[1] += w * col[1]; c[2] += w * col[2];
  }
  c[0] /= wsum; c[1] /= wsum; c[2] /= wsum;
  return c;
}

// returns [r, g, b, id]
function shade(ox, oy, oz, dx, dy, dz, v) {
  const t = march(ox, oy, oz, dx, dy, dz);
  if (t > 0) {
    const px = ox + dx * t, py = oy + dy * t, pz = oz + dz * t;
    map(px, py, pz);
    const oi = OBJ;
    let part = PART;
    const o = OB[oi];
    // local position for material decisions
    const R = o.R, is = 1 / o.s;
    const ddx = px - o.cx, ddy = py - o.cy, ddz = pz - o.cz;
    const lx = (R[0] * ddx + R[3] * ddy + R[6] * ddz) * is;
    const ly = (R[1] * ddx + R[4] * ddy + R[7] * ddz) * is;
    const lz = (R[2] * ddx + R[5] * ddy + R[8] * ddz) * is;
    if (part === BODY && lz < ZF + 0.03 && Math.sqrt(lx * lx + ly * ly) < RF - 0.005) part = FACE;
    const [nx, ny, nz] = normalAt(px, py, pz);
    const pal = o.pal;
    let alb, spec = 0.18, shin = 24, wrap = 0.35;
    switch (part) {
      case FACE: alb = pal.face; spec = 0.35; shin = 60; wrap = 0.2; break;
      case TRACK: alb = pal.track; break;
      case PROG: alb = pal.prog; spec = 0.3; shin = 40; break;
      case HAND: alb = pal.hand; spec = 0.3; shin = 40; break;
      case TICK: alb = pal.track; break;
      case ARROW: {
        // lilac at the tail, blush pink toward the head
        let a = Math.atan2(lx, ly);
        if (a < 0) a += 2 * Math.PI;
        const u = a > ARR.aT && a < ARR.aH ? (a - ARR.aT) / (ARR.aH - ARR.aT) : (a <= ARR.aT && a > ARR.aT - 0.5 ? 0 : 1);
        alb = mix(pal.arrowTail, pal.arrow, smooth(0.0, 0.7, u));
        spec = 0.55; shin = 28; wrap = 0.45; break;
      }
      case CROWN: alb = pal.crown; spec = 0.3; shin = 40; break;
      default: alb = pal.body;
    }
    const eps = 0.003;
    const sx = px + nx * eps, sy = py + ny * eps, sz = pz + nz * eps;
    const ndl = nx * KEY[0] + ny * KEY[1] + nz * KEY[2];
    const dif = clamp((ndl + wrap) / (1 + wrap), 0, 1);
    const sh = dif > 0 ? softShadow(sx, sy, sz, KEY[0], KEY[1], KEY[2], CFG.key.k, 12) : 0;
    const ao = calcAO(px, py, pz, nx, ny, nz);
    const fdl = clamp((nx * FILL[0] + ny * FILL[1] + nz * FILL[2] + 0.3) / 1.3, 0, 1);
    const skyW = 0.5 + 0.5 * ny;
    // half vector for spec
    let hx = KEY[0] - dx, hy = KEY[1] - dy, hz = KEY[2] - dz;
    const hl = Math.sqrt(hx * hx + hy * hy + hz * hz); hx /= hl; hy /= hl; hz /= hl;
    const ndh = clamp(nx * hx + ny * hy + nz * hz, 0, 1);
    const ndv = clamp(-(nx * dx + ny * dy + nz * dz), 0, 1);
    const fres = 0.04 + 0.96 * (1 - ndv) ** 5;
    const sp = spec * ndh ** shin * sh * (0.5 + fres);
    const rim = (1 - ndv) ** 3 * 0.35 * ao;
    const out = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      const lightK = CFG.key.col[k] * dif * sh;
      const amb = (CFG.sky[k] * skyW + CFG.bounce[k] * (1 - skyW)) * ao;
      out[k] = alb[k] * (lightK + amb + CFG.fill.col[k] * fdl * ao) + sp * CFG.key.col[k] + rim * C.rim[k] * 0.6;
    }
    return [out[0], out[1], out[2], 1 + oi * 16 + part];
  }
  // floor (the camera looks down steeply enough that every ray reaches it)
  if (dy < -1e-4) {
    const tf = -oy / dy;
    const px = ox + dx * tf, pz = oz + dz * tf;
    const base = backdrop(v);
    const P = CFG.pool;
    const pr2 = ((px - P.x) ** 2 + (pz - P.z) ** 2) / (P.r * P.r);
    const gain = 1 + P.gain * Math.exp(-pr2);
    let occ = 0;
    for (const [mask, w] of [[1, 1], [~1, CFG.satShadow]]) {
      ACTIVE = mask;
      const shK = softShadow(px, 0.001, pz, KEY[0], KEY[1], KEY[2], CFG.floorShadowK, 14);
      const shS = softShadow(px, 0.001, pz, 0, 1, 0, 1.6, 8);
      occ += w * ((1 - shK) * CFG.floorShadow[0] + (1 - shS) * CFG.floorShadow[1]);
    }
    ACTIVE = ~0;
    occ = clamp(occ, 0, 1);
    const out = [0, 0, 0];
    for (let k = 0; k < 3; k++) out[k] = base[k] * gain * (1 - occ * (1 - CFG.shadowMul[k]));
    return [out[0], out[1], out[2], 0];
  }
  const s = backdrop(v);
  return [s[0], s[1], s[2], 0];
}

function primary(sx, sy) {
  const { pos, f, r, u, th, aspect } = CAM;
  const x = (2 * sx / CFG.W - 1) * th * aspect, y = (1 - 2 * sy / CFG.H) * th;
  let dx = f[0] + r[0] * x + u[0] * y, dy = f[1] + r[1] * x + u[1] * y, dz = f[2] + r[2] * x + u[2] * y;
  const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
  dx /= l; dy /= l; dz /= l;
  return shade(pos[0], pos[1], pos[2], dx, dy, dz, 1 - sy / CFG.H);
}

// ---- deterministic PRNG ----------------------------------------------------------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pixelRng = (i, salt) => mulberry32((SEED ^ Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(salt, 0x85ebca6b)) >>> 0);

// ---- worker side --------------------------------------------------------------------
if (!isMainThread) {
  parentPort.on('message', (task) => {
    const { W } = CFG;
    if (task.type === 'pass1') {
      const rows = task.rows;
      const col = new Float32Array(rows.length * W * 3);
      const ids = new Int32Array(rows.length * W);
      let k = 0;
      for (const y of rows) {
        for (let x = 0; x < W; x++, k++) {
          const c = primary(x + 0.5, y + 0.5);
          col[k * 3] = c[0]; col[k * 3 + 1] = c[1]; col[k * 3 + 2] = c[2]; ids[k] = c[3];
        }
      }
      parentPort.postMessage({ type: 'pass1', rows, col, ids }, [col.buffer, ids.buffer]);
    } else if (task.type === 'pass2') {
      const idx = task.idx;
      const n = CFG.aaSamples;
      const col = new Float32Array(idx.length * 3);
      for (let j = 0; j < idx.length; j++) {
        const i = idx[j];
        const px = i % W, py = (i / W) | 0;
        const rnd = pixelRng(i, 1);
        let r = 0, g = 0, b = 0;
        for (let a = 0; a < n; a++) for (let c = 0; c < n; c++) {
          const c3 = primary(px + (c + rnd()) / n, py + (a + rnd()) / n);
          r += c3[0]; g += c3[1]; b += c3[2];
        }
        const inv = 1 / (n * n);
        col[j * 3] = r * inv; col[j * 3 + 1] = g * inv; col[j * 3 + 2] = b * inv;
      }
      parentPort.postMessage({ type: 'pass2', idx, col }, [col.buffer]);
    }
  });
}

// ---- main ---------------------------------------------------------------------------
async function main() {
  const sharp = (await import('sharp')).default;
  const { W, H } = CFG;
  const t0 = Date.now();
  const nW = Math.max(1, Math.min(16, os.cpus().length));
  const workers = Array.from({ length: nW }, () => new Worker(new URL(import.meta.url)));
  const run = (tasks) => new Promise((resolve, reject) => {
    const results = [];
    let next = 0, done = 0;
    const feed = (w) => {
      if (next >= tasks.length) return;
      w.postMessage(tasks[next++]);
    };
    for (const w of workers) {
      w.removeAllListeners('message');
      w.on('message', (m) => { results.push(m); done++; if (done === tasks.length) resolve(results); else feed(w); });
      w.on('error', reject);
      feed(w);
    }
  });

  // pass 1: one sample per pixel, in bands of 8 rows
  const tasks1 = [];
  for (let y = 0; y < H; y += 8) tasks1.push({ type: 'pass1', rows: Array.from({ length: Math.min(8, H - y) }, (_, i) => y + i) });
  const col = new Float32Array(W * H * 3);
  const ids = new Int32Array(W * H);
  for (const m of await run(tasks1)) {
    m.rows.forEach((y, ri) => {
      col.set(m.col.subarray(ri * W * 3, (ri + 1) * W * 3), y * W * 3);
      ids.set(m.ids.subarray(ri * W, (ri + 1) * W), y * W);
    });
  }
  const t1 = Date.now();

  // edge mask: id change or a luminance step against any 8-neighbour
  const lum = (i) => 0.2126 * col[i * 3] + 0.7152 * col[i * 3 + 1] + 0.0722 * col[i * 3 + 2];
  const edges = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    const li = lum(i);
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

  // tone map (soft shoulder), sRGB encode, dither
  const shoulder = (c) => (c < 0.8 ? c : 0.8 + 0.2 * (1 - Math.exp(-(c - 0.8) / 0.2)));
  const enc = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
  const buf = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const rnd = pixelRng(i, 2);
    for (let k = 0; k < 3; k++) {
      const v = enc(shoulder(Math.max(0, col[i * 3 + k] * CFG.exposure))) * 255 + (rnd() - 0.5);
      buf[i * 4 + k] = clamp(Math.round(v), 0, 255);
    }
    buf[i * 4 + 3] = 255;
  }
  mkdirSync(dirname(OUT), { recursive: true });
  const out = process.argv[2] || OUT;
  await sharp(buf, { raw: { width: W, height: H, channels: 4 } }).removeAlpha().webp({ quality: CFG.quality, effort: 6, smartSubsample: true }).toFile(out);
  if (process.env.PNG_OUT) await sharp(buf, { raw: { width: W, height: H, channels: 4 } }).removeAlpha().png().toFile(process.env.PNG_OUT);
  console.log(`wrote ${out}  pass1 ${(t1 - t0) / 1000}s  edges ${edges.length} pass2 ${(t2 - t1) / 1000}s  total ${(Date.now() - t0) / 1000}s`);
}

if (isMainThread) await main();
