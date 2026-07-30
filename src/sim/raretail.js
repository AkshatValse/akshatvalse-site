/**
 * Rare-event estimation: crude Monte Carlo against importance sampling, on the
 * one target where the answer is known to machine precision.
 *
 * The quantity is the Gaussian tail p(a) = P(Z > a) for Z ~ N(0,1). Crude Monte
 * Carlo counts the fraction of samples above a. Importance sampling draws from
 * the exponentially tilted law Q = N(a, 1) instead and reweights by
 *
 *     dP/dQ (x) = exp(-x^2/2) / exp(-(x-a)^2/2) = exp(-a x + a^2/2),
 *
 * giving the estimator  p_hat = (1/n) sum 1{X_i > a} exp(-a X_i + a^2/2),
 * X_i ~ N(a,1). The mean shift to a is the classical tilt: it is the point where
 * the rate function's derivative matches, so the event stops being rare under Q
 * and the relative error grows only polynomially in a rather than like
 * exp(a^2/2).
 *
 * This is a textbook instance, deliberately. It demonstrates the mechanism that
 * makes large-deviation-guided importance sampling work without touching the
 * unpublished state-dependent tilting it stands in for.
 *
 * Exact reference: p(a) = Phi(-a), computed by an erf series below 1.5 and by
 * the Laplace continued fraction for the Mills ratio above it. Both are checked
 * against SciPy in scripts/verify-raretail.mjs.
 */

import { makeRng } from './rng.js';

export const THRESHOLDS = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7];

const SQRT2 = Math.SQRT2;
const INV_SQRT_2PI = 0.3989422804014327;

/**
 * erf(x) for |x| <= ~1.5 by the confluent series
 *   erf(x) = (2/sqrt(pi)) e^{-x^2} sum_{n>=0} 2^n x^{2n+1} / (1·3···(2n+1)).
 * All terms are positive, so there is no cancellation.
 */
function erfSeries(x) {
  const x2 = x * x;
  let term = x, sum = x;
  for (let n = 1; n < 200; n++) {
    term *= (2 * x2) / (2 * n + 1);
    sum += term;
    if (term < 1e-18 * sum) break;
  }
  return (2 / Math.sqrt(Math.PI)) * Math.exp(-x2) * sum;
}

/**
 * Mills ratio R(a) = Phi(-a)/phi(a) by the Laplace continued fraction
 *   R = 1/(a + 1/(a + 2/(a + 3/(a + ...)))),
 * evaluated with modified Lentz. Converges quickly for a >= 1.5.
 */
function millsRatio(a) {
  const TINY = 1e-300;
  let f = TINY, C = f, D = 0;
  for (let j = 1; j < 400; j++) {
    const aj = j === 1 ? 1 : j - 1;
    D = a + aj * D;
    if (D === 0) D = TINY;
    C = a + aj / C;
    if (C === 0) C = TINY;
    D = 1 / D;
    const delta = C * D;
    f *= delta;
    if (Math.abs(delta - 1) < 1e-16) break;
  }
  return f;
}

/** Exact upper tail P(Z > a) for a >= 0. */
export function normalTail(a) {
  if (a < 1.5) return 0.5 * (1 - erfSeries(a / SQRT2));
  return INV_SQRT_2PI * Math.exp(-0.5 * a * a) * millsRatio(a);
}

/**
 * Running estimators for one threshold. Both accumulate so the figure can show
 * the estimates sharpening as n grows, rather than jumping to a final answer.
 */
class Estimator {
  constructor(a) {
    this.a = a;
    this.exact = normalTail(a);
    this.n = 0;
    /** crude Monte Carlo: number of samples above the threshold */
    this.hits = 0;
    /** importance sampling: running sums of the weights and their squares */
    this.sw = 0;
    this.sw2 = 0;
  }

  /** Crude estimate and its standard error, or null before the first hit. */
  crude() {
    if (this.hits === 0) return null;
    const p = this.hits / this.n;
    return { p, se: Math.sqrt((p * (1 - p)) / this.n) };
  }

  /** Importance-sampling estimate and its standard error. */
  is() {
    if (this.n === 0 || this.sw === 0) return null;
    const p = this.sw / this.n;
    const varW = Math.max(0, this.sw2 / this.n - p * p);
    return { p, se: Math.sqrt(varW / this.n) };
  }
}

export class RareTailSim {
  constructor(opts = {}) {
    const { seed = 'gaussian-tail/2026', thresholds = THRESHOLDS } = opts;
    this.est = thresholds.map((a) => new Estimator(a));
    const { normal } = makeRng(seed);
    this.normal = normal;
    this.n = 0;
  }

  /** Draw `m` more samples for every threshold. */
  advance(m) {
    const { normal } = this;
    for (const e of this.est) {
      const a = e.a;
      const half = 0.5 * a * a;
      let hits = 0, sw = 0, sw2 = 0;
      for (let i = 0; i < m; i++) {
        // Crude Monte Carlo under P = N(0,1).
        if (normal() > a) hits++;
        // Importance sampling under Q = N(a,1).
        const x = a + normal();
        if (x > a) {
          const w = Math.exp(-a * x + half);
          sw += w;
          sw2 += w * w;
        }
      }
      e.hits += hits;
      e.sw += sw;
      e.sw2 += sw2;
      e.n += m;
    }
    this.n += m;
  }

  /**
   * Smallest exact probability each method has actually *resolved*, meaning its
   * relative standard error is under 50%.
   *
   * "Produced any estimate" would be the wrong test. Deep in the tail crude
   * Monte Carlo occasionally lands one chance hit, which yields an estimate two
   * orders of magnitude too large with a standard error the size of the estimate.
   * Counting that as reach would flatter it.
   */
  reach(maxRelSe = 0.5) {
    let crude = null, is = null;
    for (const e of this.est) {
      const c = e.crude();
      if (c && c.se / c.p < maxRelSe) crude = e.exact;
      const s = e.is();
      if (s && s.se / s.p < maxRelSe) is = e.exact;
    }
    return { crude, is };
  }
}
