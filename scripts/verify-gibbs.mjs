/**
 * Correctness check for the hero simulation.
 *
 * Claim under test: the Euler-Maruyama chain in src/sim/hero.js has an
 * invariant law close to the Gibbs measure pi(x,y) ∝ exp(-beta V(x,y)) with
 * V = cos x + cos y on the torus.
 *
 * Because V is separable, pi factorises exactly:
 *     pi(x,y) = p(x) p(y),   p(x) = exp(-beta cos x) / (2 pi I_0(beta)),
 * so every target quantity below is closed form and nothing is fitted.
 *
 * Two tests, with different jobs:
 *
 *   A. Histogram agreement. The 1D marginal over 48 bins and the 2D joint
 *      over 24x24 bins, reported as total variation and as the largest
 *      *standardized* deviation. Raw relative deviation is not reported for
 *      the tail bins: at beta = 2 the density spans a factor of e^{8} ≈ 3000,
 *      so the corner bins hold a few dozen counts and their relative error is
 *      Monte Carlo noise, not bias.
 *
 *   B. Discretization bias, measured on E[cos X]. This has the closed form
 *          E_pi[cos X] = -I_1(beta) / I_0(beta),
 *      and far lower variance than any bin mass, so the O(h) bias of
 *      Euler-Maruyama is resolvable against Monte Carlo error. Standard
 *      errors come from batch means over time-blocks, which absorbs the
 *      correlation between snapshots.
 *
 * Run: node scripts/verify-gibbs.mjs
 */

import { HeroSim, HERO_DEFAULTS, TWO_PI } from '../src/sim/hero.js';
import { assertAtMost, finish } from './assert.mjs';

/** I_nu(z) for integer nu >= 0 by power series; exact to double precision for z <= 4. */
function besselI(nu, z) {
  const q = (z * z) / 4;
  let fact = 1;
  for (let k = 2; k <= nu; k++) fact *= k;
  let term = Math.pow(z / 2, nu) / fact;
  let sum = term;
  for (let k = 1; k <= 60; k++) {
    term *= q / (k * (k + nu));
    sum += term;
    if (term < 1e-18 * sum) break;
  }
  return sum;
}

const BETA = HERO_DEFAULTS.beta;
const DT = HERO_DEFAULTS.dt;
const I0 = besselI(0, BETA);
const I1 = besselI(1, BETA);
/** E_pi[cos X] = -I_1(beta)/I_0(beta). Sign is negative: the well sits at x = pi. */
const COS_EXACT = -I1 / I0;

const p = (x) => Math.exp(-BETA * Math.cos(x)) / (TWO_PI * I0);

/** Exact mass of [lo, lo+w] under p, by composite Simpson (p is analytic). */
function binMass(lo, w, m = 8) {
  const h = w / m;
  let s = 0;
  for (let k = 0; k <= m; k++) {
    const wgt = k === 0 || k === m ? 1 : k % 2 ? 4 : 2;
    s += wgt * p(lo + k * h);
  }
  return (s * h) / 3;
}

// ---------------------------------------------------------------------------
// A. Histogram agreement
// ---------------------------------------------------------------------------

function histogramTest({ n, dt, steps, burnIn, thin, seed, bins1d, bins2d }) {
  // One cell: the marginal check is stated on [0, 2pi).
  const sim = new HeroSim({ n, dt, beta: BETA, seed, tilesX: 1, tilesY: 1 });
  sim.advance(burnIn);

  const h1 = new Float64Array(bins1d);
  const h2 = new Float64Array(bins2d * bins2d);
  let snaps = 0;

  for (let s = 0; s < steps; s += thin) {
    sim.advance(thin);
    snaps++;
    for (let i = 0; i < n; i++) {
      const bx = Math.min(bins1d - 1, ((sim.x[i] / TWO_PI) * bins1d) | 0);
      const by = Math.min(bins1d - 1, ((sim.y[i] / TWO_PI) * bins1d) | 0);
      h1[bx] += 1; h1[by] += 1;
      const cx = Math.min(bins2d - 1, ((sim.x[i] / TWO_PI) * bins2d) | 0);
      const cy = Math.min(bins2d - 1, ((sim.y[i] / TWO_PI) * bins2d) | 0);
      h2[cy * bins2d + cx] += 1;
    }
  }

  const s1 = snaps * n * 2, s2 = snaps * n;
  const w1 = TWO_PI / bins1d, w2 = TWO_PI / bins2d;

  const rows = [];
  let tv1 = 0, maxZ1 = 0;
  for (let b = 0; b < bins1d; b++) {
    const mass = binMass(b * w1, w1);
    const obs = h1[b] / s1;
    tv1 += Math.abs(obs - mass);
    // Standardized by the binomial sd of the bin count (independence assumed;
    // correlation inflates this, so it is a floor on the true tolerance).
    const sd = Math.sqrt((mass * (1 - mass)) / s1);
    maxZ1 = Math.max(maxZ1, Math.abs(obs - mass) / sd);
    rows.push({ lo: b * w1, obs, mass, rel: (obs - mass) / mass, expCount: mass * s1 });
  }

  const mx = [];
  for (let b = 0; b < bins2d; b++) mx.push(binMass(b * w2, w2));
  let tv2 = 0, maxZ2 = 0, maxRelDense = 0, denseBins = 0;
  for (let by = 0; by < bins2d; by++) {
    for (let bx = 0; bx < bins2d; bx++) {
      const mass = mx[bx] * mx[by];
      const obs = h2[by * bins2d + bx] / s2;
      tv2 += Math.abs(obs - mass);
      const sd = Math.sqrt((mass * (1 - mass)) / s2);
      maxZ2 = Math.max(maxZ2, Math.abs(obs - mass) / sd);
      if (mass * s2 >= 1000) {
        denseBins++;
        maxRelDense = Math.max(maxRelDense, Math.abs(obs - mass) / mass);
      }
    }
  }

  return {
    rows, tv1: tv1 / 2, tv2: tv2 / 2, maxZ1, maxZ2, maxRelDense, denseBins,
    s1, s2, snaps, simTime: sim.t - burnIn * dt,
  };
}

// ---------------------------------------------------------------------------
// B. Discretization bias on E[cos X]
// ---------------------------------------------------------------------------

function meanCosTest({ n, dt, simTime, burnInTime, thin, seed, batches }) {
  // One cell: the marginal check is stated on [0, 2pi).
  const sim = new HeroSim({ n, dt, beta: BETA, seed, tilesX: 1, tilesY: 1 });
  sim.advance(Math.round(burnInTime / dt));

  const steps = Math.round(simTime / dt);
  const perBatch = Math.max(1, Math.floor(steps / batches / thin));
  const batchMeans = [];

  for (let b = 0; b < batches; b++) {
    let acc = 0, m = 0;
    for (let k = 0; k < perBatch; k++) {
      sim.advance(thin);
      for (let i = 0; i < n; i++) { acc += Math.cos(sim.x[i]) + Math.cos(sim.y[i]); m += 2; }
    }
    batchMeans.push(acc / m);
  }

  const mean = batchMeans.reduce((a, v) => a + v, 0) / batches;
  const varB = batchMeans.reduce((a, v) => a + (v - mean) ** 2, 0) / (batches - 1);
  return { mean, se: Math.sqrt(varB / batches) };
}

// ---------------------------------------------------------------------------

console.log('Hero simulation — invariant measure check');
console.log('='.repeat(76));
console.log('potential    V(x,y) = cos x + cos y   on the torus [0, 2pi)^2');
console.log(`beta         ${BETA}`);
console.log(`I_0(beta)    ${I0.toFixed(12)}      I_1(beta)  ${I1.toFixed(12)}`);
console.log('target       p(x) = exp(-beta cos x) / (2 pi I_0(beta)),   pi = p(x) p(y)');
console.log(`integrator   Euler-Maruyama, h = ${DT}\n`);

const t0 = Date.now();
const bins1d = 48, bins2d = 24;
const A = histogramTest({
  n: 2048, dt: DT, steps: 300000, burnIn: 20000, thin: 200,
  seed: 'verify/main', bins1d, bins2d,
});

console.log('A. HISTOGRAM AGREEMENT');
console.log(`   ${(2048).toLocaleString()} particles, simulated time ${A.simTime.toFixed(0)} after burn-in,`);
console.log(`   ${A.snaps} snapshots, ${A.s1.toLocaleString()} marginal samples\n`);
console.log('   Marginal in x, every 4th bin:');
console.log('     x_lo      observed     exact        rel.dev.    exp.count');
for (let i = 0; i < A.rows.length; i += 4) {
  const r = A.rows[i];
  console.log(
    `     ${r.lo.toFixed(3).padStart(6)}    ${r.obs.toFixed(6)}    ${r.mass.toFixed(6)}    ` +
    `${(r.rel >= 0 ? '+' : '')}${(r.rel * 100).toFixed(2).padStart(5)}%    ${Math.round(r.expCount).toLocaleString().padStart(9)}`
  );
}
console.log('');
console.log(`   total variation, 1D marginal (${bins1d} bins)        ${A.tv1.toExponential(3)}`);
console.log(`   total variation, 2D joint (${bins2d}x${bins2d} bins)      ${A.tv2.toExponential(3)}`);
console.log(`   max standardized deviation, 1D              ${A.maxZ1.toFixed(2)} sd`);
console.log(`   max standardized deviation, 2D              ${A.maxZ2.toFixed(2)} sd`);
console.log(`   max rel. dev. over 2D bins with >=1000 exp. counts   ${(A.maxRelDense * 100).toFixed(2)}%  (${A.denseBins}/${bins2d * bins2d} bins)`);
console.log('   Standardization assumes independent samples, so these sd counts are');
console.log('   a lower bound on the true tolerance; snapshots 0.8 time units apart');
console.log('   are correlated within a well.');

console.log('\n' + '-'.repeat(76));
console.log('B. Discretization BIAS,  E[cos X] = -I_1(beta)/I_0(beta)');
console.log(`   exact value  ${COS_EXACT.toFixed(9)}\n`);
console.log('      h        estimate      std.err.     bias        bias/h');
const biases = [];
for (const h of [0.032, 0.016, 0.008, 0.004]) {
  const r = meanCosTest({
    n: 1024, dt: h, simTime: 900, burnInTime: 60,
    thin: Math.max(1, Math.round(0.4 / h)), seed: `verify/h-${h}`, batches: 24,
  });
  const bias = r.mean - COS_EXACT;
  biases.push({ h, bias, se: r.se });
  console.log(
    `   ${h.toFixed(3)}    ${r.mean.toFixed(6)}    ${('±' + r.se.toFixed(6)).padStart(10)}   ` +
    `${(bias >= 0 ? '+' : '')}${bias.toFixed(6)}   ${(bias / h).toFixed(4).padStart(8)}`
  );
}
console.log('\n   Euler-Maruyama has an O(h) bias in the invariant law, so bias/h should');
console.log('   be roughly constant. At the shipped step size the bias is the last row.');

console.log(`\nelapsed ${((Date.now() - t0) / 1000).toFixed(1)} s`);

// --- contract ---------------------------------------------------------------
// The site quotes TV 1.0e-3 against the Gibbs marginal and a 9e-4 bias on
// E[cos X]. Measured 2026-07-30: TV(1D) 1.021e-3, TV(2D) 3.945e-3, bias at the
// shipped h = 0.004 was 9.25e-4 with a standard error of 3.9e-4. The bias
// tolerance is 3e-3, roughly three times the measured value and well inside the
// O(h) budget; a doubling of the step size would show as ~1.9e-3 and still pass,
// while a broken integrator moves it by orders of magnitude.
const shipped = biases[biases.length - 1];
console.log('\nCONTRACT');
assertAtMost('total variation, 1D marginal', A.tv1, 3e-3, '(measured 1.02e-3)');
assertAtMost('total variation, 2D joint', A.tv2, 1e-2, '(measured 3.95e-3)');
assertAtMost('max standardized deviation, 1D', A.maxZ1, 6, '(measured 3.04 sd)');
assertAtMost(`|bias| on E[cos X] at h = ${shipped.h}`,
  Math.abs(shipped.bias), 3e-3, '(measured 9.25e-4)');
finish('verify-gibbs');
