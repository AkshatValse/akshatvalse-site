/**
 * Model F of "Inside the Trap" (arXiv:2611.08902, Sec. 3 and App. A): a fluid
 * FIFO server on which every turn misses. Turn k costs c_k seconds of server
 * time, a finished turn rejoins the queue at once as turn k + 1, and new
 * sessions arrive at rate lam. With G_k = P(T >= k):
 *
 *   lam_miss = 1 / sum_k c_k G_k                       (all-miss capacity)
 *   sum_k lam c_k G_k z^-k = 1                         (Perron root z, Lemma 2)
 *
 * and for lam > lam_miss every trapped state converges to a self-similar regime
 * (Theorem 1) in which the gap between turns grows at z - 1, the backlog at
 * alpha = lam (1 - E[z^-T]), sessions complete at D = lam E[z^-T], and the turns
 * served follow the tilted mix nu_k proportional to G_k z^-k: young and short.
 *
 * c_k is the miss prefill time of turn k under the calibrated cost model plus
 * delta, the all-miss per-turn decode share, exactly as the paper's
 * analysis/theory/icml/trap_renewal.py builds it for the A100 300k cell.
 *
 * Used at build time (figure captions) and by scripts/verify-trap.mjs; none of
 * it ships to the browser.
 */

export const COST = { a: 0.00924, f0: 0.00126, b: 6.26e-5, cp: 2.24e-9, Bc: 8192, delta: 0.0796863257131043 };
export const MODEL_WL = { L0: 2000, step: 650, q: 1 - 1 / 15, K: 60 };

/** Per-turn prompt P_k, survival G_k, cost c_k, P(T = k); E[T] and lam_miss. */
export function costs(cost = COST, wl = MODEL_WL) {
  const K = wl.K, P = [], G = [], c = [], p = [];
  for (let k = 1; k <= K; k++) {
    const x = wl.L0 + (k - 1) * wl.step;
    P.push(x);
    G.push(Math.pow(wl.q, k - 1));
    const tPm = cost.a * Math.max(1, x / cost.Bc) + Math.max(cost.f0, cost.b * x) + cost.cp * x * (x + 1) / 2;
    c.push(tPm + cost.delta);
  }
  for (let k = 0; k < K; k++) p.push(G[k] - (k + 1 < K ? G[k + 1] : 0));
  let ET = 0, cG = 0;
  for (let k = 0; k < K; k++) { ET += G[k]; cG += c[k] * G[k]; }
  return { P, G, c, p, ET, lamMiss: 1 / cG };
}

/** phi(z) - 1 = sum_k lam c_k G_k z^-k - 1, decreasing in z. */
export function phiMinusOne(lam, z, tc) {
  let s = 0;
  for (let k = 0; k < tc.c.length; k++) s += lam * tc.c[k] * tc.G[k] * Math.pow(z, -(k + 1));
  return s - 1;
}

/** Perron root (Lemma 2), by bisection on log z. */
export function perron(lam, tc) {
  const f = (lz) => {
    let s = 0;
    for (let k = 0; k < tc.c.length; k++) s += lam * tc.c[k] * tc.G[k] * Math.exp(-(k + 1) * lz);
    return s - 1;
  };
  let lo = -1, hi = 1;
  while (f(lo) < 0) lo *= 2;
  while (f(hi) > 0) hi *= 2;
  for (let i = 0; i < 200; i++) { const m = 0.5 * (lo + hi); if (f(m) > 0) lo = m; else hi = m; }
  return Math.exp(0.5 * (lo + hi));
}

/** Theorem 1(a) and Theorem 2 quantities at arrival rate lam. */
export function trapLimits(lam, tc = costs()) {
  const z = perron(lam, tc);
  let S = 0, Ez = 0, PS = 0, PG = 0, kS = 0, cGz = 0, cG = 0;
  for (let k = 0; k < tc.c.length; k++) {
    const w = Math.pow(z, -(k + 1));
    S += tc.G[k] * w; Ez += tc.p[k] * w; PS += tc.P[k] * tc.G[k] * w; kS += (k + 1) * tc.G[k] * w;
    PG += tc.P[k] * tc.G[k]; cGz += tc.c[k] * tc.G[k] * w; cG += tc.c[k] * tc.G[k];
  }
  const D = lam * Ez;
  return {
    lam, rho: lam / tc.lamMiss, z, gamma: z - 1,
    alpha: lam * (1 - Ez), D, DoverMiss: D / tc.lamMiss,
    H: tc.ET * Ez / S, Gamma: (cG / tc.ET) / (cGz / S),
    Pserved: PS / S, kServed: kS / S, Pstat: PG / tc.ET,
  };
}
