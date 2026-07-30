/**
 * A two-dimensional Gaussian mixture with an exactly known score, and the
 * variance-preserving noise schedule of a continuous-time diffusion model.
 *
 * This is the toy in which a diffusion model's sampler can be checked rather
 * than admired. The forward VP-SDE
 *
 *     dX_t = -\tfrac12 \beta(t) X_t\,dt + \sqrt{\beta(t)}\,dW_t,  t in [0,1],
 *
 * has Gaussian transition kernel X_t | X_0 ~ N(alpha_t X_0, (1 - alpha_t^2) I)
 * with alpha_t = exp(-\tfrac12 \int_0^t \beta). A Gaussian mixture is closed
 * under that kernel, so every marginal is again a mixture,
 *
 *     p_t = \sum_k w_k N(alpha_t mu_k, v_t I),  v_t = alpha_t^2 sigma^2 + 1 - alpha_t^2,
 *
 * and the score \nabla \log p_t is available in closed form. Substituting it
 * into Anderson's reverse-time SDE gives a sampler with an *oracle* score:
 * whatever it gets wrong is the fault of the sampler or the discretisation,
 * never of a network. Since the mixture weights are unequal and known, the
 * sampler can be graded on whether it reproduces them — the mode-coverage
 * question, with an answer key.
 */

/** Component means, chosen to fill a 2:1 frame. */
export const MEANS = [
  [-2.5, 0.9],
  [-0.9, -0.9],
  [0.6, 1.0],
  [2.4, 0.5],
  [1.5, -1.0],
  [-2.2, -0.7],
];

/** Deliberately unequal: equal weights make mode coverage untestable. */
export const WEIGHTS = [0.28, 0.22, 0.17, 0.14, 0.11, 0.08];

export const SIGMA = 0.26;
export const K = MEANS.length;

/** Display window, 2:1. */
export const BOX = { x0: -3.6, x1: 3.6, y0: -1.8, y1: 1.8 };

/** Linear VP schedule, the DDPM default carried into continuous time. */
export const BETA_MIN = 0.1;
export const BETA_MAX = 20;

export const beta = (t) => BETA_MIN + t * (BETA_MAX - BETA_MIN);

/** alpha_t = exp(-1/2 \int_0^t beta(s) ds). */
export function alphaOf(t) {
  const integral = BETA_MIN * t + 0.5 * (BETA_MAX - BETA_MIN) * t * t;
  return Math.exp(-0.5 * integral);
}

/** Marginal component variance at time t (isotropic). */
export function varOf(t) {
  const a = alphaOf(t);
  return a * a * SIGMA * SIGMA + (1 - a * a);
}

const LOG_W = WEIGHTS.map(Math.log);

/**
 * Score of p_t at (x, y), returned as [sx, sy]. Responsibilities are formed
 * through a log-sum-exp so that the far tails, where every component
 * underflows, still produce the right direction rather than 0/0.
 */
export function score(x, y, t) {
  const a = alphaOf(t);
  const v = varOf(t);
  let max = -Infinity;
  const lg = new Array(K);
  for (let k = 0; k < K; k++) {
    const dx = x - a * MEANS[k][0];
    const dy = y - a * MEANS[k][1];
    // Shared -log(2 pi v) omitted: it cancels in the normalisation.
    lg[k] = LOG_W[k] - (dx * dx + dy * dy) / (2 * v);
    if (lg[k] > max) max = lg[k];
  }
  let sum = 0;
  for (let k = 0; k < K; k++) { lg[k] = Math.exp(lg[k] - max); sum += lg[k]; }

  let sx = 0, sy = 0;
  for (let k = 0; k < K; k++) {
    const r = lg[k] / sum;
    sx += r * (a * MEANS[k][0] - x);
    sy += r * (a * MEANS[k][1] - y);
  }
  return [sx / v, sy / v];
}

/**
 * The data-space energy phi = -log p_0, up to the additive constant
 * log(2 pi sigma^2). Used for the colormap and the contours, exactly as the
 * potential V is used in the hero: colour encodes energy.
 */
export function energy(x, y) {
  const s2 = SIGMA * SIGMA;
  let max = -Infinity;
  const lg = new Array(K);
  for (let k = 0; k < K; k++) {
    const dx = x - MEANS[k][0];
    const dy = y - MEANS[k][1];
    lg[k] = LOG_W[k] - (dx * dx + dy * dy) / (2 * s2);
    if (lg[k] > max) max = lg[k];
  }
  let sum = 0;
  for (let k = 0; k < K; k++) sum += Math.exp(lg[k] - max);
  return -(max + Math.log(sum));
}

/** phi and its gradient, for antialiased contouring. */
export function energyGrad(x, y) {
  const s2 = SIGMA * SIGMA;
  let max = -Infinity;
  const lg = new Array(K);
  for (let k = 0; k < K; k++) {
    const dx = x - MEANS[k][0];
    const dy = y - MEANS[k][1];
    lg[k] = LOG_W[k] - (dx * dx + dy * dy) / (2 * s2);
    if (lg[k] > max) max = lg[k];
  }
  let sum = 0;
  for (let k = 0; k < K; k++) { lg[k] = Math.exp(lg[k] - max); sum += lg[k]; }

  let gx = 0, gy = 0;
  for (let k = 0; k < K; k++) {
    const r = lg[k] / sum;
    gx += (r * (x - MEANS[k][0])) / s2;
    gy += (r * (y - MEANS[k][1])) / s2;
  }
  return [-(max + Math.log(sum)), gx, gy];
}

/** Index of the nearest component mean; the grading rule for mode coverage. */
export function nearestMode(x, y) {
  let best = 0, bd = Infinity;
  for (let k = 0; k < K; k++) {
    const dx = x - MEANS[k][0], dy = y - MEANS[k][1];
    const d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = k; }
  }
  return best;
}
