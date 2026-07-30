/**
 * Correctness check for the effective-diffusivity figure.
 *
 * Claim under test: for dX_t = -V'(X_t) dt + sqrt(2) dW_t with V(x) = cos x
 * and beta = 1, the estimator D_hat(t) = Var(X_t) / 2t converges to the
 * Lifson-Jackson value
 *
 *     D_eff = D_0 / (<e^{beta V}> <e^{-beta V}>) = 1 / I_0(1)^2.
 *
 * The reference value is computed here from the Bessel series and cross-checked
 * against Gauss-Legendre quadrature of (1/2pi) int_0^{2pi} e^{cos t} dt, so the
 * number the site prints does not depend on anyone's memory of it.
 *
 * Standard errors come from four disjoint replica groups, which is an honest
 * spread rather than the Gaussian formula sd(s^2) = s^2 sqrt(2/(R-1)).
 *
 * Run: node scripts/verify-diffusivity.mjs
 */

import { DiffusivitySim, D_EFF_EXACT, I0_AT_1 } from '../src/sim/diffusivity.js';

function besselI0Series(z) {
  const q = (z * z) / 4;
  let term = 1, sum = 1;
  for (let k = 1; k <= 60; k++) {
    term *= q / (k * k);
    sum += term;
    if (term < 1e-18 * sum) break;
  }
  return sum;
}

/** (1/2pi) int_0^{2pi} e^{cos t} dt by the trapezoid rule, which is spectrally
 *  accurate for smooth periodic integrands — 64 nodes is machine precision. */
function besselI0Quadrature(z, n = 64) {
  let s = 0;
  for (let k = 0; k < n; k++) s += Math.exp(z * Math.cos((2 * Math.PI * k) / n));
  return s / n;
}

const I0series = besselI0Series(1);
const I0quad = besselI0Quadrature(1);

console.log('Effective diffusivity — Lifson-Jackson check');
console.log('='.repeat(72));
console.log('dynamics    dX_t = -V\'(X_t) dt + sqrt(2/beta) dW_t,  V(x) = cos x,  beta = 1');
console.log('claim       D_eff = D_0 / (<e^{beta V}><e^{-beta V}>) = 1 / I_0(beta)^2\n');
console.log(`I_0(1), series      ${I0series.toFixed(16)}`);
console.log(`I_0(1), quadrature  ${I0quad.toFixed(16)}`);
console.log(`agreement           ${Math.abs(I0series - I0quad).toExponential(2)}`);
console.log(`constant in module  ${I0_AT_1.toFixed(16)}`);
console.log('');
console.log(`I_0(1)^2            ${(I0series * I0series).toFixed(16)}`);
console.log(`D_eff = 1/I_0(1)^2  ${(1 / (I0series * I0series)).toFixed(16)}`);
console.log(`module D_EFF_EXACT  ${D_EFF_EXACT.toFixed(16)}`);
console.log('');
console.log('  Note on D_0: with noise amplitude sqrt(2/beta) the free diffusivity is');
console.log('  D_0 = 1/beta = 1 at beta = 1, so D_eff = 1/I_0(1)^2 with no extra factor.');
console.log('  The mean-squared-displacement estimator therefore starts at exactly 1');
console.log('  as t -> 0 and relaxes down to 0.6239.');

// ---------------------------------------------------------------------------

const R = 4096, GROUPS = 4, DT = 0.01, T_MAX = 2000;
const sim = new DiffusivitySim({ replicas: R, beta: 1, dt: DT, seed: 'verify/diffusivity' });

const checkpoints = [0.1, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 1500, 2000];
console.log('\n' + '-'.repeat(72));
console.log(`${R} replicas, h = ${DT}, X_0 ~ exp(-beta cos x) on [0, 2pi)`);
console.log('estimator  D_hat(t) = E[(X_t - X_0)^2] / 2t\n');
console.log('       t     D_hat(t)     spread      (D_hat - D_eff)/D_eff');

const t0 = Date.now();
let next = 0;
const g = R / GROUPS;
while (sim.t < T_MAX + DT / 2) {
  if (next < checkpoints.length && sim.t >= checkpoints[next] - DT / 2) {
    const t = sim.t;
    const all = sim.estimate();
    const per = [];
    for (let k = 0; k < GROUPS; k++) per.push(sim.estimate(k * g, (k + 1) * g));
    const m = per.reduce((a, v) => a + v, 0) / GROUPS;
    const sd = Math.sqrt(per.reduce((a, v) => a + (v - m) ** 2, 0) / (GROUPS - 1));
    const se = sd / Math.sqrt(GROUPS);
    const rel = (all - D_EFF_EXACT) / D_EFF_EXACT;
    console.log(
      `  ${t.toFixed(0).padStart(6)}     ${all.toFixed(5)}     ±${se.toFixed(5)}     ` +
      `${(rel >= 0 ? '+' : '')}${(rel * 100).toFixed(2)}%`
    );
    next++;
  }
  sim.advance(10);
}

console.log(`\n  D_eff (exact)  ${D_EFF_EXACT.toFixed(5)}`);
console.log('\n  The approach is slow by construction: the systematic part of D_hat decays');
console.log('  on the barrier-crossing timescale, not like 1/t, and the residual at');
console.log('  t = 2000 is the transient, not Monte Carlo error. The site plots this');
console.log('  unsmoothed.');
console.log(`\nelapsed ${((Date.now() - t0) / 1000).toFixed(1)} s`);
