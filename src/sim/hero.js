/**
 * Overdamped Langevin dynamics in the 2D egg-crate potential
 *
 *     dX_t = -grad V(X_t) dt + sqrt(2/beta) dW_t,   V(x,y) = cos x + cos y.
 *
 * The invariant measure is the Gibbs measure pi ∝ exp(-beta V), with wells at
 * (pi, pi) + 2pi Z^2 where V = -2 and saddles at V = 0. Barrier height is 2,
 * so the Kramers escape rate is O(exp(-2 beta)); beta = 2 puts the hopping on
 * a timescale a reader can watch without waiting.
 *
 * The state space is the torus [0, 2pi m) x [0, 2pi n). Any (m, n) is a period
 * of V, so the dynamics and the invariant measure per unit cell are identical
 * for every choice — m and n only set how many wells fill the canvas, and are
 * picked from its aspect ratio. scripts/verify-gibbs.mjs runs at m = n = 1 and
 * the result transfers unchanged.
 *
 * Integrator: Euler-Maruyama, fixed step, hand-written. The discretisation
 * bias in the invariant law is O(h) and is measured, not assumed.
 *
 * No DOM dependencies: the same module runs in the browser, in the
 * correctness check, and in the build-time poster generator.
 */

import { makeRng } from './rng.js';

export const TWO_PI = Math.PI * 2;

export const HERO_DEFAULTS = {
  /** Particles per unit cell; the total scales with the number of cells. */
  density: 54,
  beta: 2.0,
  dt: 0.004,
  tilesX: 6,
  tilesY: 2,
  seed: 'egg-crate/2026',
};

/** V(x,y) = cos x + cos y, range [-2, 2]. */
export function V(x, y) {
  return Math.cos(x) + Math.cos(y);
}

/** Map V into [0,1] for the colormap. */
export function vNorm(v) {
  return (v + 2) / 4;
}

/** Choose a cell tiling for a canvas of the given aspect ratio. */
export function tilesForAspect(aspect) {
  const tilesY = aspect < 1.1 ? 2 : 2;
  const tilesX = Math.max(2, Math.min(9, Math.round(tilesY * aspect)));
  return { tilesX, tilesY };
}

export class HeroSim {
  constructor(opts = {}) {
    const o = { ...HERO_DEFAULTS, ...opts };
    this.tilesX = o.tilesX;
    this.tilesY = o.tilesY;
    this.spanX = TWO_PI * o.tilesX;
    this.spanY = TWO_PI * o.tilesY;
    this.n = o.n ?? Math.round(o.density * o.tilesX * o.tilesY);
    this.beta = o.beta;
    this.dt = o.dt;
    /** sqrt(2 h / beta) — the per-step noise amplitude. */
    this.sigma = Math.sqrt((2 * this.dt) / this.beta);
    this.t = 0;
    this.x = new Float64Array(this.n);
    this.y = new Float64Array(this.n);

    const { rand, normal } = makeRng(o.seed);
    this.rand = rand;
    this.normal = normal;

    // Start uniform. Uniform is not the invariant measure, so the opening
    // seconds show relaxation onto the Gibbs measure — the particles visibly
    // collect into the wells. That transient is the most legible part.
    for (let i = 0; i < this.n; i++) {
      this.x[i] = rand() * this.spanX;
      this.y[i] = rand() * this.spanY;
    }
  }

  /**
   * One Euler-Maruyama step:
   *   X_{k+1} = X_k - grad V(X_k) h + sqrt(2h/beta) xi,   xi ~ N(0, I).
   * With V = cos x + cos y, -dV/dx = sin x and -dV/dy = sin y.
   */
  step() {
    const { x, y, n, dt, sigma, spanX, spanY, normal } = this;
    for (let i = 0; i < n; i++) {
      let xi = x[i] + Math.sin(x[i]) * dt + sigma * normal();
      let yi = y[i] + Math.sin(y[i]) * dt + sigma * normal();
      // Wrap. The step is far smaller than one period, so one conditional
      // pair per coordinate suffices and no modulo is needed.
      if (xi < 0) xi += spanX; else if (xi >= spanX) xi -= spanX;
      if (yi < 0) yi += spanY; else if (yi >= spanY) yi -= spanY;
      x[i] = xi;
      y[i] = yi;
    }
    this.t += dt;
  }

  /** Advance `k` steps. The physics timestep is fixed; only `k` varies. */
  advance(k) {
    for (let j = 0; j < k; j++) this.step();
  }
}
