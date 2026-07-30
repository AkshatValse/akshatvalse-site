/**
 * Ancestral sampling from a continuous-time diffusion model, with the exact
 * score.
 *
 * Anderson's time-reversal of the VP forward SDE is
 *
 *     dX = [ -\tfrac12 \beta(t) X - \beta(t) \nabla\log p_t(X) ] dt + \sqrt{\beta(t)}\, d\bar W,
 *
 * integrated from t = 1 down to t \approx 0. Discretizing with Euler-Maruyama
 * on a uniform grid in t and stepping backwards by \Delta > 0 gives
 *
 *     X \leftarrow X + \Delta\big[\tfrac12 \beta(t) X + \beta(t) s(X, t)\big] + \sqrt{\beta(t)\Delta}\,\xi,
 *
 * which is the predictor of predictor-corrector samplers and is DDPM's update
 * in the continuum limit. Initialization is X ~ N(0, I), the prior the forward
 * process converges to.
 *
 * Because s is the true score rather than a learned one, the only sources of
 * error are the discretization and the prior mismatch at t = 1. That makes the
 * recovered mixture weights a genuine grade for the sampler.
 */

import { makeRng } from './rng.js';
import { beta, score, nearestMode, WEIGHTS, K } from './mixture.js';

export const DIFFUSION_DEFAULTS = {
  n: 640,
  steps: 320,
  /** Stop short of 0: beta(t) -> beta_min but v_t -> sigma^2, and the last
   *  few steps buy nothing while costing numerical headroom. */
  tEnd: 0.004,
  seed: 'vp-sde/2026',
};

export class DiffusionSampler {
  constructor(opts = {}) {
    const o = { ...DIFFUSION_DEFAULTS, ...opts };
    this.n = o.n;
    this.steps = o.steps;
    this.tEnd = o.tEnd;
    this.dt = (1 - o.tEnd) / o.steps;
    this.x = new Float64Array(this.n);
    this.y = new Float64Array(this.n);
    const { normal } = makeRng(o.seed);
    this.normal = normal;
    this.restart();
  }

  /** Draw a fresh prior sample and rewind to t = 1. */
  restart() {
    const { normal } = this;
    for (let i = 0; i < this.n; i++) {
      this.x[i] = normal();
      this.y[i] = normal();
    }
    this.k = 0;
    this.t = 1;
  }

  get done() {
    return this.k >= this.steps;
  }

  /** One reverse Euler-Maruyama step. */
  step() {
    if (this.done) return;
    const { x, y, n, dt, normal } = this;
    const t = this.t;
    const b = beta(t);
    const sd = Math.sqrt(b * dt);
    const half = 0.5 * b * dt;
    const bd = b * dt;

    for (let i = 0; i < n; i++) {
      const [sx, sy] = score(x[i], y[i], t);
      x[i] += half * x[i] + bd * sx + sd * normal();
      y[i] += half * y[i] + bd * sy + sd * normal();
    }
    this.k++;
    this.t = Math.max(this.tEnd, 1 - this.k * dt);
  }

  advance(m) {
    for (let j = 0; j < m && !this.done; j++) this.step();
  }

  /**
   * Empirical mixture weights by nearest-mean assignment, and the largest
   * absolute deviation from the true weights. With n samples the Monte Carlo
   * standard error on each weight is sqrt(w(1-w)/n), about 0.018 at w = 0.28
   * and n = 640, so a max deviation of a few hundredths is the noise floor and
   * not a defect.
   */
  coverage() {
    const counts = new Float64Array(K);
    for (let i = 0; i < this.n; i++) counts[nearestMode(this.x[i], this.y[i])]++;
    let maxDev = 0;
    const w = new Array(K);
    for (let k = 0; k < K; k++) {
      w[k] = counts[k] / this.n;
      maxDev = Math.max(maxDev, Math.abs(w[k] - WEIGHTS[k]));
    }
    // Total variation between the empirical and true weight vectors.
    let tv = 0;
    for (let k = 0; k < K; k++) tv += Math.abs(w[k] - WEIGHTS[k]);
    return { w, maxDev, tv: tv / 2 };
  }
}
