/**
 * The trap: a prefix-cached LLM serving engine under agent traffic, as in
 * "Inside the Trap: A Renewal Law for Prefix-Cache Collapse in LLM Agent
 * Serving" (Valse and Jannesari, arXiv:2611.08902).
 *
 * This is a JavaScript port of one code path of the paper's calibrated
 * discrete-event simulator (src/prefixmeta/engine.py in the paper's
 * repository: full-reserve KV allocation, mixed prefill/decode batching,
 * first-come-first-served admission with no skip-ahead, whole-session LRU
 * eviction, KV freed when a session ends) and of its client-side session
 * gate (src/prefixmeta/gate_control.py). It runs iteration by iteration. On
 * the same session plan it reproduces the Python engine run the same way
 * (configs/r6_predict.yaml with engine.batch_decode_iterations=false) exactly:
 * the same turn, hit, iteration and eviction counts and every completion time
 * to the last bit. With the paper's default, which advances runs of pure-decode
 * iterations in closed form, the counts and the order of turns are still
 * identical and completion times agree to about 2e-10 s. scripts/verify-trap.mjs
 * checks the counts; scripts/trap-golden/ regenerates its reference from the
 * paper's repository.
 *
 * The costs are the paper's server-log fit for SGLang 0.5.22 on an A100 80GB
 * with Qwen2.5-7B-Instruct and a 300,000-token KV pool; the workload is the
 * paper's: sessions of min(Geometric(1/15), 60) turns, prompts of
 * 2000 + 650 (k - 1) tokens at turn k, exponential tool calls of mean 5 s.
 *
 * Determinism: the engine uses only + - * / and comparisons, which IEEE 754
 * fixes to the last bit, and the plan generator avoids Math.log (whose last
 * bit is left to each JavaScript engine) in favor of ln() below. The run a
 * reader's browser draws is therefore the run the verification script grades.
 */

import { makeRng } from './rng.js';

/** Iteration-time model and pool (paper, App. E; calibration.yaml). */
export const ENGINE = {
  iterFixed: 0.00924,     // a, s per iteration
  iterFloor: 0.00126,     // f0, s
  perToken: 6.26e-5,      // b, s per token in the batch
  decodeAttn: 0.00031,    // c_d, s per 8192 tokens of decode context
  attnNorm: 8192,
  prefillAttn: 2.24e-9,   // c_p, s per causal token pair
  chunk: 8192,            // prefill tokens per iteration
  maxRunning: 256,
  M: 300000,              // KV pool, tokens
  cache: true,
};

/** Agent workload (paper, Sec. 2 and App. E). */
export const WORKLOAD = { L0: 2000, delta: 550, d: 100, pEnd: 1 / 15, maxTurns: 60, toolMean: 5 };

/** The paper's unit of load: the measured all-miss session rate of this cell. */
export const LAMBDA_REF = 0.071534;

/** The registered burst protocol (paper, App. E.2), at 1.35 lambda_ref. */
export const PROTOCOL = { mult: 1.35, H: 8700, tB: 1200, burstN: 200, burstW: 60, window: [5700, 8700] };

/** Gates: none, the static cap of the CAPPED arm, and the R1 rescue cap. */
export const GATES = {
  none: { mode: 'none' },
  capped: { mode: 'static', cap: 20, tick: 10 },
  rescue: { mode: 'rescue', cap: 20, tOn: 1800, pause: true, releaseHold: 300, minOn: 600, tick: 10 },
};

/**
 * The run drawn on the site, chosen once from DISPLAY_CANDIDATES. All 40 follow
 * the protocol in every arm. Among the 9 in which every burst session finishes
 * before H, the 5 whose rescue cap comes off inside the paper's engine range
 * (3,980-4,550 s) were kept, and of those the one whose trapped completion rate
 * is closest to model F's (1.118 against 1.126 lambda_miss). The pages say it
 * was selected, and the claims they generalize are checked on FURTHER_SEEDS,
 * which played no part in the choice.
 */
export const DISPLAY_SEED = 'trap/2026/30';
export const DISPLAY_CANDIDATES = ['trap/2026', ...Array.from({ length: 39 }, (_, k) => `trap/2026/${k + 1}`)];
export const FURTHER_SEEDS = Array.from({ length: 40 }, (_, k) => `verify/trap/${k}`);

// ---------------------------------------------------------------------------
// Deterministic natural logarithm
// ---------------------------------------------------------------------------

const LN2 = 0.6931471805599453;
const SQRT2 = 1.4142135623730951;

/**
 * ln(x) for finite x > 0 using only exact scaling by 2 and a fixed-length
 * atanh series, so every JavaScript engine returns the same double. That is
 * the point of it; its accuracy (relative error below 1e-15, about 4 ulp, on
 * (0, 1]) is a little worse than Math.log's.
 */
export function ln(x) {
  let e = 0;
  while (x >= 2) { x /= 2; e++; }
  while (x < 1) { x *= 2; e--; }
  if (x > SQRT2) { x /= 2; e++; }
  const s = (x - 1) / (x + 1), s2 = s * s;
  // 2 atanh(s) = 2 (s + s^3/3 + ... + s^25/25); |s| < 0.1716, so the tail is < 1e-20.
  let term = s, sum = s;
  for (let j = 3; j <= 25; j += 2) { term *= s2; sum += term / j; }
  return e * LN2 + 2 * sum;
}

// ---------------------------------------------------------------------------
// Session plans
// ---------------------------------------------------------------------------

function sessionSpec(rand) {
  // T = min(Geometric(1/15), 60) by Bernoulli trials: P(T >= k) = (14/15)^(k-1).
  let T = 1;
  while (T < WORKLOAD.maxTurns && rand() >= WORKLOAD.pEnd) T++;
  const z = new Array(T - 1);
  for (let j = 0; j < T - 1; j++) z[j] = -WORKLOAD.toolMean * ln(1 - rand());   // Exp(5 s)
  return { T, z };
}

/**
 * Base sessions: a Poisson(lam) stream on [0, H). Burst: burstN sessions
 * uniform on [tB, tB + burstW). Separate streams, so every arm sees the same
 * base sessions (common random numbers), as in the paper's protocol.
 */
export function drawSessions(seed, lam, { H, tB, burstN, burstW } = PROTOCOL) {
  const rA = makeRng(`${seed}/arrivals`).rand;
  const rS = makeRng(`${seed}/sessions`).rand;
  const rB = makeRng(`${seed}/burst`).rand;
  const base = [];
  for (let t = 0; ;) {
    t += -ln(1 - rA()) / lam;
    if (t >= H) break;
    base.push({ a: t, burst: false, ...sessionSpec(rS) });
  }
  const burst = [];
  for (let i = 0; i < burstN; i++) burst.push({ a: tB + burstW * rB(), burst: true, ...sessionSpec(rB) });
  return { base, burst };
}

/** Engine plan, sorted by arrival time (stable: base before burst on ties). */
export function toPlan(sessions) {
  const s = sessions.map((x, i) => ({ x, i })).sort((u, v) => u.x.a - v.x.a || u.i - v.i);
  const arrival = [], nTurns = [], toolOff = [], toolFlat = [], isBurst = [];
  for (const { x } of s) {
    arrival.push(x.a); nTurns.push(x.T); toolOff.push(toolFlat.length); isBurst.push(x.burst);
    for (const v of x.z) toolFlat.push(v);
  }
  return { arrival, nTurns, toolOff, toolFlat, isBurst };
}

/** The display plan: base plus burst at mult * LAMBDA_REF. */
export function displayPlan(seed = DISPLAY_SEED, mult = PROTOCOL.mult) {
  const { base, burst } = drawSessions(seed, mult * LAMBDA_REF);
  return toPlan([...base, ...burst]);
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

/** Min-heap of [key1, key2, payload], ordered by key1 then key2. */
class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  top() { return this.a[0]; }
  static lt(x, y) { return x[0] < y[0] || (x[0] === y[0] && x[1] < y[1]); }
  push(x) {
    const a = this.a; a.push(x);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!Heap.lt(a[i], a[p])) break;
      [a[i], a[p]] = [a[p], a[i]]; i = p;
    }
  }
  pop() {
    const a = this.a, r = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1, rr = l + 1; let m = i;
        if (l < a.length && Heap.lt(a[l], a[m])) m = l;
        if (rr < a.length && Heap.lt(a[rr], a[m])) m = rr;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]]; i = m;
      }
    }
    return r;
  }
}

const BIG = 1e9;

export class TrapEngine {
  /**
   * plan: {arrival, nTurns, toolOff, toolFlat} sorted by arrival.
   * gate: one of GATES. record: keep one row per completed turn
   * [t, sid, turn, hit, uncachedTokens] (the verifier needs them; the
   * browser does not). closed: replace each finished session at once
   * (the closed population of the paper's all-miss measurement).
   */
  constructor(plan, gate = GATES.none, { eng = ENGINE, wl = WORKLOAD, record = false, closed = false } = {}) {
    this.p = eng; this.wl = wl; this.plan = plan; this.closed = closed; this.record = record;
    const n = plan.arrival.length;
    this.n = n;
    this.turn = new Int32Array(n);
    this.arrivedT = new Float64Array(n);
    this.tDone = new Float64Array(n).fill(NaN);
    this.nextIdx = 0;
    this.now = 0; this.G = 0; this.nD = 0; this.sumOff = 0;
    this.doneHeap = new Heap(); this.prefill = []; this.pendingDone = [];
    this.idle = new Map(); this.idleSum = 0; this.reserved = 0;
    this.q = []; this.qh = 0; this.waiting = new Map(); this.nWait = 0;
    this.gateQ = []; this.inSystem = 0; this.toolHeap = new Heap(); this.toolSeq = 0; this.rid = 0; this.dirty = false;
    // counters
    this.nTurnsDone = 0; this.nAdmitted = 0; this.nHits = 0; this.nEvictions = 0; this.nIterations = 0;
    this.nSessionsDone = 0; this.fuTurns = 0; this.fuHits = 0; this.lastDoneT = NaN;
    this.done = [];
    // gate
    this.g = gate;
    this.cap = gate.mode === 'static' ? gate.cap : (gate.mode === 'none' ? null : BIG);
    this.nextTick = gate.mode === 'none' ? Infinity : (gate.tick ?? 10);
    this.paused = new Map(); this.nPausedFront = 0; this.nPauses = 0;
    this.tEngage = null; this.tRelease = null; this.released = false; this.gateEmptySince = 0;
  }

  promptLen(k) { return this.wl.L0 + (k - 1) * (this.wl.delta + this.wl.d); }

  /** Sessions the client has sent and not yet seen finish, gate included. */
  get sessions() { return this.inSystem + this.gateQ.length; }

  // --- session lifecycle (engine.py, gate_control.py) ------------------------
  arrive(i, t) {
    this.arrivedT[i] = t;
    const g0 = this.gateQ.length;
    if (this.cap !== null && this.inSystem >= this.cap) this.gateQ.push(i);
    else this.enter(i, t);
    this.noteGate(t, g0);
  }
  enter(i, t) {
    if (this.paused.has(i)) {                 // a paused session resumes at its pending turn
      const ready = this.paused.get(i);
      this.paused.delete(i); this.nPausedFront--;
      this.inSystem++; this.enqueueBase(i, t, ready);
      return;
    }
    this.inSystem++; this.turn[i] = 1; this.enqueueTurn(i, t, this.arrivedT[i]);
  }
  enqueueTurn(sid, t, ready) {
    const g = this.g;
    if (g.mode === 'rescue' && g.pause && this.turn[sid] > 1 && this.cap < BIG && this.inSystem > this.cap && !this.paused.has(sid)) {
      this.inSystem--; this.paused.set(sid, ready);
      this.gateQ.splice(this.nPausedFront, 0, sid); this.nPausedFront++; this.nPauses++;
      return;
    }
    this.enqueueBase(sid, t, ready);
  }
  enqueueBase(sid, t, ready) {
    const k = this.turn[sid], prompt = this.promptLen(k);
    const req = { rid: this.rid++, sid, turn: k, qtime: t, ready, prompt, end: prompt + this.wl.d, alive: true,
                  pos: 0, rem: 0, offs: 0, doneG: 0, hit: false };
    this.q.push(req); this.waiting.set(sid, req); this.nWait++;
    this.dirty = true;
  }
  noteGate(t, before) { if (before > 0 && this.gateQ.length === 0) this.gateEmptySince = t; }

  // --- exogenous events: arrivals, tool returns, gate ticks -----------------
  processExogenous(now) {
    const arr = this.plan.arrival;
    for (;;) {
      const ta = this.nextIdx < this.n ? arr[this.nextIdx] : Infinity;
      const tt = this.toolHeap.size ? this.toolHeap.top()[0] : Infinity;
      const tk = this.nextTick;
      if (ta <= tt && ta <= tk) { if (ta > now) return; this.arrive(this.nextIdx++, ta); }
      else if (tt <= tk) { if (tt > now) return; const [t, , sid] = this.toolHeap.pop(); this.enqueueTurn(sid, t, t); }
      else { if (tk > now) return; this.tick(tk); }
    }
  }
  nextExogenousTime() {
    const ta = this.nextIdx < this.n ? this.plan.arrival[this.nextIdx] : Infinity;
    const tt = this.toolHeap.size ? this.toolHeap.top()[0] : Infinity;
    return Math.min(ta, tt, this.nextTick);
  }
  tick(tt) {
    const g = this.g;
    this.nextTick += g.tick ?? 10;
    if (g.mode === 'rescue') {
      const gl = this.gateQ.length, quiet = gl > 0 ? 0 : tt - this.gateEmptySince;
      if (this.tEngage === null) {
        if (tt >= g.tOn) { this.tEngage = tt; this.cap = g.cap; }
      } else if (!this.released) {
        if (gl === 0 && quiet >= g.releaseHold && tt >= this.tEngage + g.minOn) {
          this.released = true; this.tRelease = tt; this.cap = BIG;
        }
      }
    }
    const g0 = this.gateQ.length;
    while (this.gateQ.length && this.inSystem < this.cap) this.enter(this.gateQ.shift(), tt);
    this.noteGate(tt, g0);
  }

  // --- completion -----------------------------------------------------------
  finish(req, t) {
    const g0 = this.gateQ.length;
    const unc = req.hit && req.turn > 1 ? this.wl.delta : req.prompt;
    if (this.record) this.done.push([t, req.sid, req.turn, req.hit ? 1 : 0, unc]);
    if (req.turn >= 2) { this.fuTurns++; if (req.hit) this.fuHits++; }
    this.reserved -= req.end; this.nTurnsDone++; this.dirty = true; this.lastDoneT = t;
    const sid = req.sid;
    if (req.turn < this.plan.nTurns[sid]) {
      if (this.p.cache) { this.idle.set(sid, req.end); this.idleSum += req.end; }   // MRU end of the LRU
      const z = this.plan.toolFlat[this.plan.toolOff[sid] + req.turn - 1];
      this.turn[sid] = req.turn + 1;
      this.toolHeap.push([t + z, ++this.toolSeq, sid]);
    } else {
      this.nSessionsDone++; this.inSystem--; this.tDone[sid] = t;
      if (this.gateQ.length && this.inSystem < this.cap) this.enter(this.gateQ.shift(), t);
      if (this.closed && this.nextIdx < this.n) this.arrive(this.nextIdx++, t);
    }
    this.noteGate(t, g0);
  }
  processDone() {
    if (!this.pendingDone.length) return;
    const pend = this.pendingDone;
    this.pendingDone = [];
    for (const r of pend) this.finish(r, this.now);
  }

  // --- admission ------------------------------------------------------------
  admit(req) {
    const sid = req.sid;
    let neu;
    if (this.idle.has(sid)) {
      const kv = this.idle.get(sid);
      this.idle.delete(sid); this.idleSum -= kv;
      req.hit = true; req.pos = kv; neu = req.prompt - kv;
    } else { req.hit = false; req.pos = 0; neu = req.prompt; }
    let need = this.reserved + req.end + this.idleSum - this.p.M;
    while (need > 0) {                        // evict whole idle sessions, least recently used first
      const [sid2, kv2] = this.idle.entries().next().value;
      this.idle.delete(sid2); this.idleSum -= kv2; this.nEvictions++; need -= kv2;
    }
    this.reserved += req.end;
    req.alive = false; this.waiting.delete(sid); this.nWait--;
    req.rem = neu; this.prefill.push(req); this.nAdmitted++;
    if (req.hit) this.nHits++;
    return neu;
  }
  schedulePass() {
    this.dirty = false;
    if (this.nWait === 0) return;
    let nRun = this.nD + this.prefill.length;
    let pending = 0;
    for (const r of this.prefill) pending += r.rem;
    let budgetLeft = this.p.chunk - pending;
    const q = this.q;
    for (let i = this.qh; i < q.length; i++) {
      const req = q[i];
      if (!req.alive) continue;
      if (nRun >= this.p.maxRunning || budgetLeft <= 0) break;
      if (!(this.reserved + req.end <= this.p.M)) break;     // FCFS, no skip-ahead
      const neu = this.admit(req);
      nRun++; budgetLeft -= neu;
    }
    let h = this.qh;
    while (h < q.length && !q[h].alive) h++;
    if (h > 4096 && h * 2 > q.length) { q.splice(0, h); h = 0; }
    this.qh = h;
  }

  // --- iterations (mixed batching) -------------------------------------------
  collectDoneDecodes() {
    const hp = this.doneHeap;
    while (hp.size && hp.top()[0] <= this.G) {
      const [, , req] = hp.pop();
      this.nD--; this.sumOff -= req.offs; this.pendingDone.push(req);
    }
  }
  iterateWithPrefill() {
    const p = this.p;
    let budget = p.chunk, ntok = 0, attn = 0;
    const chunks = [];
    for (const req of this.prefill) {
      if (budget <= 0) break;
      const c = req.rem < budget ? req.rem : budget;
      chunks.push([req, c]); budget -= c; ntok += c; attn += c * (req.pos + 0.5 * c);
    }
    const nD = this.nD;
    const sumctx = this.sumOff + nD * this.G;
    let tokT = p.perToken * (ntok + nD);
    if (tokT < p.iterFloor) tokT = p.iterFloor;
    const tau = p.iterFixed + tokT + p.decodeAttn * sumctx / p.attnNorm + p.prefillAttn * attn;
    this.now = this.now + tau;
    this.G += 1; this.nIterations++;
    this.collectDoneDecodes();
    const d = this.wl.d, G = this.G;
    let fin = false;
    for (const [req, c] of chunks) { req.pos += c; req.rem -= c; if (req.rem === 0) fin = true; }
    if (fin) {
      const keep = [];
      for (const req of this.prefill) {
        if (req.rem > 0) { keep.push(req); continue; }
        const remDec = d - 1;
        if (remDec <= 0) { this.pendingDone.push(req); continue; }
        req.offs = (req.pos + 1) - G; req.doneG = G + remDec; this.sumOff += req.offs; this.nD++;
        this.doneHeap.push([req.doneG, req.rid, req]);
      }
      this.prefill = keep;
    }
    this.dirty = true;
  }
  iterateDecode() {
    const p = this.p, nD = this.nD;
    const c0 = p.iterFixed + Math.max(p.iterFloor, p.perToken * nD);
    const a = p.decodeAttn / p.attnNorm;
    const tau0 = c0 + a * (this.sumOff + nD * this.G);
    this.now = this.now + tau0;
    this.G += 1; this.nIterations++;
    this.collectDoneDecodes();
  }

  /**
   * Run until now >= horizon (engine.py run()). Exact under chunking: any
   * sequence of horizons reaches the same state as one call to the last.
   */
  advanceTo(horizon) {
    while (this.now < horizon) {
      this.processExogenous(this.now);
      this.processDone();
      if (this.dirty) this.schedulePass();
      if (this.nD === 0 && this.prefill.length === 0) {
        if (this.nWait > 0) throw new Error('trap engine: idle with waiting requests');
        const nxt = this.nextExogenousTime();
        if (nxt >= horizon) { this.now = horizon; break; }
        this.now = nxt;
        continue;
      }
      if (this.prefill.length) this.iterateWithPrefill(); else this.iterateDecode();
    }
  }
}

// ---------------------------------------------------------------------------
// Scene: the same plan through several gates, binned for drawing
// ---------------------------------------------------------------------------

/** Seconds per drawn bin. */
export const BIN = 30;

/**
 * Advances one engine per lane on a shared clock, sampling the number of
 * sessions in the system once per simulated second and binning, per lane,
 * the mean of those samples and the follow-up turns (turn >= 2) completed
 * and served from cache. Used identically by the page, the poster and the
 * verifier.
 */
export class TrapScene {
  constructor({ plan = displayPlan(), lanes = [GATES.none, GATES.rescue], H = PROTOCOL.H } = {}) {
    this.H = H;
    this.engines = lanes.map((g) => new TrapEngine(plan, g));
    this.plan = plan;
    this.s = 0;                                // last sampled second
    this.bins = lanes.map(() => []);           // {n, fu, hit}
    this.acc = lanes.map(() => ({ sum: 0, fu0: 0, hit0: 0 }));
  }

  get t() { return this.s; }
  get done() { return this.s >= this.H; }

  /** Advance to simulated time t (seconds, clamped to H). */
  advanceTo(t) {
    const target = Math.min(this.H, Math.floor(t));
    while (this.s < target) {
      const s = ++this.s;
      for (let j = 0; j < this.engines.length; j++) {
        const e = this.engines[j], a = this.acc[j];
        e.advanceTo(s);
        a.sum += e.sessions;
        if (s % BIN === 0) {
          this.bins[j].push({ n: a.sum / BIN, fu: e.fuTurns - a.fu0, hit: e.fuHits - a.hit0 });
          a.sum = 0; a.fu0 = e.fuTurns; a.hit0 = e.fuHits;
        }
      }
    }
  }

  /** Burst sessions not yet finished in lane j. */
  burstLeft(j) {
    const e = this.engines[j];
    let k = 0;
    for (let i = 0; i < e.n; i++) if (this.plan.isBurst[i] && e.arrivedT[i] > 0 && Number.isNaN(e.tDone[i])) k++;
    return k;
  }
}

/** Follow-up hit fraction of a bin, or null if no follow-up turn finished. */
export function hitFraction(bin) { return bin.fu > 0 ? bin.hit / bin.fu : null; }

// ---------------------------------------------------------------------------
// Window statistics, as the paper's protocol defines them (App. E.2)
// ---------------------------------------------------------------------------

/**
 * Statistics of a finished run over [t0, t1). Needs an engine built with
 * record: true. Turns are counted at completion; "sessions in system" counts
 * every session that has arrived and not finished, gate included, sampled each
 * second and averaged in 10 s bins, and its slope is the OLS slope of those
 * bin means, as in the registered rule.
 */
export function windowStats(e, [t0, t1] = PROTOCOL.window) {
  let n = 0, fu = 0, fuHit = 0, promptSum = 0, uncached = 0;
  for (const d of e.done) {
    if (d[0] < t0 || d[0] >= t1) continue;
    n++; promptSum += e.promptLen(d[2]); uncached += d[4];
    if (d[2] >= 2) { fu++; fuHit += d[3]; }
  }
  let completions = 0;
  for (let i = 0; i < e.n; i++) if (e.tDone[i] >= t0 && e.tDone[i] < t1) completions++;
  const A = Array.from(e.plan.arrival).sort((a, b) => a - b);
  const D = Array.from(e.tDone, (v) => (Number.isNaN(v) ? Infinity : v)).sort((a, b) => a - b);
  const upTo = (S, t) => { let lo = 0, hi = S.length; while (lo < hi) { const m = (lo + hi) >> 1; if (S[m] <= t) lo = m + 1; else hi = m; } return lo; };
  const xs = [], ys = [];
  for (let b = t0; b < t1; b += 10) {
    let s = 0;
    for (let t = b; t < b + 10; t++) s += upTo(A, t) - upTo(D, t);
    xs.push(b + 5); ys.push(s / 10);
  }
  const mx = xs.reduce((a, x) => a + x, 0) / xs.length, my = ys.reduce((a, y) => a + y, 0) / ys.length;
  let sxy = 0, sxx = 0;
  for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; }
  return {
    fuHit: fu ? fuHit / fu : NaN, turns: n, meanPrompt: promptSum / n,
    completionRate: completions / (t1 - t0), uncachedRate: uncached / (t1 - t0),
    sessionsMean: my, sessionsSlope: sxy / sxx,
  };
}

/** Burst sessions still open at the end, and when the last finished one ended. */
export function burstEnd(e) {
  let open = 0, last = 0;
  for (let i = 0; i < e.n; i++) {
    if (!e.plan.isBurst[i]) continue;
    if (Number.isNaN(e.tDone[i])) open++; else if (e.tDone[i] > last) last = e.tDone[i];
  }
  return { open, last };
}

/** Follow-up turns completed at or after t, and how many were cache hits. */
export function followUpsAfter(e, t) {
  let fu = 0, hit = 0;
  for (const d of e.done) if (d[0] >= t && d[2] >= 2) { fu++; hit += d[3]; }
  return { fu, hit };
}
