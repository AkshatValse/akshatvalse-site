/**
 * Effective diffusivity of overdamped Langevin dynamics in a cosine potential.
 *
 *     dX_t = -V'(X_t) dt + sqrt(2/beta) dW_t,   V(x) = cos x,   beta = 1.
 *
 * The Lifson-Jackson formula gives the exact long-time diffusivity of a
 * periodic one-dimensional diffusion,
 *
 *     D_eff = D_0 / (<e^{beta V}> <e^{-beta V}>),
 *
 * where the averages are over one period. For V = cos x both averages are the
 * modified Bessel function I_0(beta), so with D_0 = 1/beta = 1 at beta = 1,
 *
 *     D_eff = 1 / I_0(1)^2 = 0.6238603604320694...
 *
 * The estimator is the mean squared displacement,
 *
 *     D_hat(t) = E[(X_t - X_0)^2] / 2t,
 *
 * over independent replicas, with X unwrapped (never reduced mod 2pi) and
 * X_0 drawn from the periodised Gibbs measure. Using the displacement rather
 * than Var(X_t) matters for the figure: displacement gives D_hat(0+) = D_0 = 1
 * exactly, so the curve reads as free diffusion relaxing onto the trapped
 * value, whereas Var(X_t) carries an O(1)/2t offset from the spread of X_0
 * and diverges at small t. Both converge to the same limit.
 *
 * D_hat is genuinely noisy and genuinely slow: the systematic part decays on
 * the barrier-crossing timescale, not on 1/t. It is not smoothed here.
 */

import { makeRng } from './rng.js';

export const TWO_PI = Math.PI * 2;

/** I_0(1) to double precision, cross-checked against numerical quadrature. */
export const I0_AT_1 = 1.2660658777520082;
/** D_eff = 1 / I_0(1)^2 at beta = 1. */
export const D_EFF_EXACT = 1 / (I0_AT_1 * I0_AT_1);

export const DIFF_DEFAULTS = {
  replicas: 1024,
  beta: 1.0,
  dt: 0.01,
  seed: 'lifson-jackson/2026',
};

export class DiffusivitySim {
  constructor(opts = {}) {
    const o = { ...DIFF_DEFAULTS, ...opts };
    this.r = o.replicas;
    this.beta = o.beta;
    this.dt = o.dt;
    this.sigma = Math.sqrt((2 * o.dt) / o.beta);
    this.t = 0;
    this.x = new Float64Array(this.r);
    this.x0 = new Float64Array(this.r);

    const { rand, normal } = makeRng(o.seed);
    this.normal = normal;

    // X_0 ~ exp(-beta cos x) on [0, 2pi), by rejection against the uniform
    // envelope exp(beta). Acceptance rate is 1/I_0(beta) ≈ 0.79 at beta = 1.
    for (let i = 0; i < this.r; i++) {
      for (;;) {
        const u = rand() * TWO_PI;
        if (rand() < Math.exp(-o.beta * Math.cos(u) - o.beta)) {
          this.x[i] = u;
          this.x0[i] = u;
          break;
        }
      }
    }
  }

  step() {
    const { x, r, dt, sigma, normal } = this;
    for (let i = 0; i < r; i++) {
      // -V'(x) = sin x. No wrapping: displacement must accumulate.
      x[i] += Math.sin(x[i]) * dt + sigma * normal();
    }
    this.t += dt;
  }

  advance(k) {
    for (let j = 0; j < k; j++) this.step();
  }

  /** D_hat(t) = E[(X_t - X_0)^2] / 2t over the replica ensemble. */
  estimate(from = 0, to = this.r) {
    if (this.t <= 0) return NaN;
    const { x, x0 } = this;
    let msd = 0;
    for (let i = from; i < to; i++) {
      const d = x[i] - x0[i];
      msd += d * d;
    }
    msd /= to - from;
    return msd / (2 * this.t);
  }
}
