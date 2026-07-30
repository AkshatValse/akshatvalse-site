/**
 * Correctness check for the diffusion-model sampler.
 *
 * Claim under test: reverse-time integration of the VP-SDE with the exact
 * score reproduces the target mixture — the right modes, in the right
 * proportions, with the right spread.
 *
 * Three graded quantities, all with known answers:
 *   1. mixture weights, by nearest-mean assignment, against the true weights
 *   2. component means, against MEANS
 *   3. within-component standard deviation, against SIGMA
 *
 * The weight check is the one that matters. A sampler that drops or inflates a
 * mode still produces individually plausible points; only the proportions
 * catch it, and they are exactly what a generative model is usually not held
 * to. Standard errors are Monte Carlo, sqrt(w(1-w)/n).
 *
 * A discretization sweep follows, because the reverse SDE's error is dominated
 * by the step count and that dependence should be visible rather than assumed.
 *
 * Run: node scripts/verify-diffusion.mjs
 */

import { DiffusionSampler } from '../src/sim/diffusion.js';
import { MEANS, WEIGHTS, SIGMA, K, nearestMode } from '../src/sim/mixture.js';
import { assertAtMost, finish } from './assert.mjs';

function run({ n, steps, seed }) {
  const s = new DiffusionSampler({ n, steps, seed });
  s.advance(steps);

  const counts = new Float64Array(K);
  const mx = new Float64Array(K), my = new Float64Array(K);
  for (let i = 0; i < n; i++) {
    const k = nearestMode(s.x[i], s.y[i]);
    counts[k]++; mx[k] += s.x[i]; my[k] += s.y[i];
  }
  const sx = new Float64Array(K);
  for (let k = 0; k < K; k++) { if (counts[k]) { mx[k] /= counts[k]; my[k] /= counts[k]; } }
  for (let i = 0; i < n; i++) {
    const k = nearestMode(s.x[i], s.y[i]);
    sx[k] += (s.x[i] - mx[k]) ** 2 + (s.y[i] - my[k]) ** 2;
  }

  const rows = [];
  let maxW = 0, tv = 0, maxMu = 0;
  for (let k = 0; k < K; k++) {
    const w = counts[k] / n;
    const dmu = Math.hypot(mx[k] - MEANS[k][0], my[k] - MEANS[k][1]);
    // Two coordinates per point, so the pooled per-coordinate sd divides by 2.
    const sd = counts[k] > 1 ? Math.sqrt(sx[k] / (2 * counts[k] - 2)) : NaN;
    maxW = Math.max(maxW, Math.abs(w - WEIGHTS[k]));
    tv += Math.abs(w - WEIGHTS[k]);
    maxMu = Math.max(maxMu, dmu);
    rows.push({ k, w, se: Math.sqrt((WEIGHTS[k] * (1 - WEIGHTS[k])) / n), dmu, sd, count: counts[k] });
  }
  return { rows, maxW, tv: tv / 2, maxMu };
}

console.log('Diffusion-model sampler — target recovery check');
console.log('='.repeat(74));
console.log('forward     dX = -1/2 beta(t) X dt + sqrt(beta(t)) dW,  linear VP, beta in [0.1, 20]');
console.log('reverse     dX = [-1/2 beta X - beta grad log p_t(X)] dt + sqrt(beta) dWbar');
console.log('score       exact (mixture closed under the VP kernel), not learned');
console.log(`target      ${K}-component Gaussian mixture, sigma = ${SIGMA}, unequal weights\n`);

const N = 16384, STEPS = 320;
const t0 = Date.now();
const r = run({ n: N, steps: STEPS, seed: 'verify/diffusion' });

console.log(`${N.toLocaleString()} samples, ${STEPS} reverse steps\n`);
console.log('   k   mean            true w    recovered   ± s.e.    |mu_hat - mu|   sd_hat');
for (const row of r.rows) {
  const m = MEANS[row.k];
  console.log(
    `   ${row.k}   (${m[0].toFixed(1).padStart(4)}, ${m[1].toFixed(1).padStart(4)})    ` +
    `${WEIGHTS[row.k].toFixed(2)}      ${row.w.toFixed(4)}    ±${row.se.toFixed(4)}   ` +
    `${row.dmu.toFixed(4).padStart(9)}       ${row.sd.toFixed(4)}`
  );
}
console.log('');
console.log(`   max |w_hat - w|          ${r.maxW.toFixed(4)}`);
console.log(`   total variation, weights ${r.tv.toFixed(4)}`);
console.log(`   max |mu_hat - mu|        ${r.maxMu.toFixed(4)}`);
console.log(`   target sd                ${SIGMA}`);

console.log('\n' + '-'.repeat(74));
console.log('Discretization sweep (n = 8192 each):\n');
console.log('   steps    max |w_hat - w|    TV(weights)    max |mu_hat - mu|');
for (const steps of [40, 80, 160, 320, 640]) {
  const s = run({ n: 8192, steps, seed: `verify/steps-${steps}` });
  console.log(
    `   ${String(steps).padStart(5)}    ${s.maxW.toFixed(4).padStart(11)}    ` +
    `${s.tv.toFixed(4).padStart(11)}    ${s.maxMu.toFixed(4).padStart(14)}`
  );
}
console.log('\n   Monte Carlo floor on max |w_hat - w| at n = 8192 is about');
console.log(`   ${Math.sqrt((0.28 * 0.72) / 8192).toFixed(4)}, so rows near that value are noise, not bias.`);
console.log(`\nelapsed ${((Date.now() - t0) / 1000).toFixed(1)} s`);

// --- contract ---------------------------------------------------------------
// Measured 2026-07-30 at n = 16384: maxW 0.0060, maxMu 0.0096, sd 0.2616-0.2711.
// The Monte Carlo s.e. on the largest weight is 0.0035, so 0.02 is about six of
// them: wide enough that sampling noise cannot trip it, tight enough that a
// sampler which drops a mode will.
console.log('\nCONTRACT');
assertAtMost('max |w_hat - w|', r.maxW, 0.02, '(measured 0.0060, MC s.e. 0.0035)');
assertAtMost('total variation, weights', r.tv, 0.03, '(measured 0.0060)');
assertAtMost('max |mu_hat - mu|', r.maxMu, 0.05, '(measured 0.0096)');
assertAtMost('max |sd_hat - sigma|',
  Math.max(...r.rows.map((x) => Math.abs(x.sd - SIGMA))), 0.03, `(sigma = ${SIGMA})`);
finish('verify-diffusion');
