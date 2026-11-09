/**
 * Classical restart arithmetic for the agent-reliability page.
 *
 * CLASSICAL BASELINE, NOT PROJECT DATA. Everything here assumes a run-time law
 * that is known exactly and restarts that are independent and identically
 * distributed. Nothing is fitted to agent data, and nothing here describes the
 * project's method, which is held back.
 *
 * A cutoff-tau policy kills any attempt still running at age tau and relaunches
 * it at cost c >= 0, paid on each relaunch (not on the first launch). With F the
 * CDF of one attempt's run time T, S = 1 - F, density f and
 * A(tau) = E[min(T, tau)]:
 *
 *   E[T_{tau,c}]        = (A + c S) / F
 *   m(tau)              = E[(T - tau)^+] / S          (mean residual life)
 *   E[T]                = F E[T_{tau,c}] + S (m - c)   (finite E[T])
 *   d/dtau E[T_{tau,c}] = (S F - f (A + c)) / F^2
 *
 * so restarting at tau beats never restarting iff m(tau) > E[T] + c, and an
 * interior optimum satisfies E[T_{tau*,c}] = 1/h(tau*) - c.
 *
 * Laws are finite mixtures of lognormals, optionally with an atom at infinity
 * (a run that hangs forever). Lognormal pieces are closed forms in the normal
 * CDF, evaluated with the site's normalTail (erf series below 1.5, Laplace
 * continued fraction above), always on the tail that avoids cancellation.
 */
import { normalTail } from '../../sim/raretail.js';
import { makeRng } from '../../sim/rng.js';

/** One lognormal component: weight w, T = exp(mu + sigma Z). */
export interface Component { w: number; mu: number; sigma: number }

/** A run-time law: lognormal components plus probability `hang` of never finishing. */
export interface Law { comps: Component[]; hang: number }

/** F, S, f, A = E[min(T, tau)] and R = E[(T - tau)^+ ; T finite] at one cutoff. */
export interface Pieces { F: number; S: number; f: number; A: number; R: number }

export interface Optimum {
  /** Best cutoff found (grid minimum refined by bisection on the FOC numerator). */
  tau: number;
  /** E[T_{tau,c}] at that cutoff. */
  time: number;
  /** False when the minimum sits on the edge of the search range. */
  interior: boolean;
  /** True when bisection on the sign of S F - f (A + c) located it. */
  bisected: boolean;
}

const INV_SQRT_2PI = 0.3989422804014327;

/** P(Z > x) for standard normal Z, accurate in both tails. */
export const upper = (x: number): number => (x >= 0 ? normalTail(x) : 1 - normalTail(-x));

/** P(Z <= x) for standard normal Z, accurate in both tails. */
export const lower = (x: number): number => (x >= 0 ? 1 - normalTail(x) : normalTail(-x));

/** Lognormal with median 1. */
export const lognormal = (sigma: number): Law => ({ comps: [{ w: 1, mu: 0, sigma }], hang: 0 });

/** Illustrative two-mode law: fast runs (median 1) and slow runs, both with sigma 0.5. */
export const twoMode = (slowFraction: number, slowMedian: number): Law => ({
  comps: [
    { w: 1 - slowFraction, mu: 0, sigma: 0.5 },
    { w: slowFraction, mu: Math.log(slowMedian), sigma: 0.5 },
  ].filter((k) => k.w > 0),
  hang: 0,
});

/** Runs that hang forever with probability q; finishing runs lognormal, median 1, sigma 1. */
export const hanging = (q: number): Law => ({ comps: [{ w: 1 - q, mu: 0, sigma: 1 }], hang: q });

export function pieces(law: Law, tau: number): Pieces {
  let F = 0;
  let S = law.hang;
  let f = 0;
  let A = law.hang * tau;
  let R = 0;
  const lt = Math.log(tau);
  for (const { w, mu, sigma } of law.comps) {
    const z = (lt - mu) / sigma;
    const m1 = Math.exp(mu + 0.5 * sigma * sigma);
    const Sk = upper(z);
    F += w * lower(z);
    S += w * Sk;
    f += (w * INV_SQRT_2PI * Math.exp(-0.5 * z * z)) / (sigma * tau);
    A += w * (m1 * lower(z - sigma) + tau * Sk);
    R += w * (m1 * upper(z - sigma) - tau * Sk);
  }
  return { F, S, f, A, R: Math.max(R, 0) };
}

/** E[T], never restarting. Infinite when runs can hang. */
export const meanTime = (law: Law): number =>
  law.hang > 0 ? Infinity : law.comps.reduce((s, { w, mu, sigma }) => s + w * Math.exp(mu + 0.5 * sigma * sigma), 0);

/** E[T_{tau,c}] = (A + c S) / F. */
export const policyTime = (p: Pieces, c: number): number => (p.A + c * p.S) / p.F;

/** m(tau) = E[T - tau | T > tau]. Infinite when runs can hang. */
export const meanResidual = (law: Law, p: Pieces): number => (law.hang > 0 ? Infinity : p.R / p.S);

/** Numerator of d/dtau E[T_{tau,c}]: S F - f (A + c). */
export const focNumerator = (p: Pieces, c: number): number => p.S * p.F - p.f * (p.A + c);

/**
 * Best cutoff on [lo, hi]: the minimum of E[T_{tau,c}] on a log grid, refined by
 * bisection on the sign of the FOC numerator. Golden-section search on E itself
 * fails where the objective is flat to machine precision; bisection on the
 * numerator does not.
 */
export function optimum(law: Law, c: number, lo = 1e-3, hi = 1e5, n = 801): Optimum {
  const a0 = Math.log(lo);
  const a1 = Math.log(hi);
  let best = 0;
  let bestE = Infinity;
  const grid: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = Math.exp(a0 + ((a1 - a0) * i) / (n - 1));
    grid.push(t);
    const e = policyTime(pieces(law, t), c);
    if (e < bestE) { bestE = e; best = i; }
  }
  if (best === 0 || best === n - 1) return { tau: grid[best], time: bestE, interior: false, bisected: false };
  let a = Math.log(grid[best - 1]);
  let b = Math.log(grid[best + 1]);
  const g = (x: number) => focNumerator(pieces(law, Math.exp(x)), c);
  if (!(g(a) < 0 && g(b) > 0)) return { tau: grid[best], time: bestE, interior: true, bisected: false };
  for (let k = 0; k < 200 && b - a > 1e-15; k++) {
    const m = 0.5 * (a + b);
    if (g(m) < 0) a = m;
    else b = m;
  }
  const tau = Math.exp(0.5 * (a + b));
  return { tau, time: policyTime(pieces(law, tau), c), interior: true, bisected: true };
}

/** Seeded sampler of one attempt's run time (Infinity for a run that hangs). */
export function makeSampler(law: Law, seed: string): () => number {
  const { rand, normal } = makeRng(seed);
  const total = law.comps.reduce((s, k) => s + k.w, 0);
  return () => {
    if (law.hang > 0 && rand() < law.hang) return Infinity;
    let k = 0;
    if (law.comps.length > 1) {
      let u = rand() * total;
      while (k < law.comps.length - 1 && u >= law.comps[k].w) { u -= law.comps[k].w; k++; }
    }
    const { mu, sigma } = law.comps[k];
    return Math.exp(mu + sigma * normal());
  };
}

/**
 * Direct simulation of the restart process at one cutoff: draw attempts until
 * one finishes by tau, paying tau + c for each attempt killed. Keeps running
 * sums so the estimate can be shown converging.
 */
export class RestartSim {
  n = 0;
  attempts = 0;
  private sum = 0;
  private sum2 = 0;
  private readonly draw: () => number;
  private readonly tau: number;
  private readonly c: number;

  constructor(law: Law, tau: number, c: number, seed: string) {
    this.draw = makeSampler(law, seed);
    this.tau = tau;
    this.c = c;
  }

  /** Simulate whole replications until about `budget` attempts have been drawn, or `maxN` replications exist. */
  advance(budget: number, maxN = Infinity): void {
    const { tau, c } = this;
    let used = 0;
    while (used < budget && this.n < maxN) {
      let total = 0;
      for (;;) {
        used++;
        const t = this.draw();
        if (t <= tau) { total += t; break; }
        total += tau + c;
      }
      this.n++;
      this.sum += total;
      this.sum2 += total * total;
    }
    this.attempts += used;
  }

  get mean(): number { return this.sum / this.n; }

  get se(): number {
    const m = this.mean;
    return Math.sqrt(Math.max(0, this.sum2 / this.n - m * m) / this.n);
  }
}
