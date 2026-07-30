/**
 * Correctness check for the rare-event figure.
 *
 * Two claims under test.
 *
 *   A. The exact reference is exact. normalTail(a) is compared against SciPy's
 *      scipy.stats.norm.sf, which is the ground truth the figure's dashed curve
 *      is drawn from. An erf series is used below a = 1.5 and the Laplace
 *      continued fraction above it, so the join at 1.5 gets checked too.
 *
 *   B. The importance-sampling estimator is unbiased and stays accurate where
 *      crude Monte Carlo stops working. Both estimators are run at every
 *      threshold and compared against the exact value in units of their own
 *      standard error, which is the only fair comparison: an estimator that is
 *      within one standard error of the truth is doing its job, whatever the
 *      magnitude.
 *
 * Run: node scripts/verify-raretail.mjs
 */

import { execFileSync } from 'node:child_process';
import { RareTailSim, normalTail, THRESHOLDS } from '../src/sim/raretail.js';
import { assertAtMost, finish } from './assert.mjs';

console.log('Rare-event estimation — exactness and estimator check');
console.log('='.repeat(78));
console.log('target      p(a) = P(Z > a),  Z ~ N(0,1)');
console.log('crude       fraction of N(0,1) samples above a');
console.log('IS          X ~ N(a,1),  weight exp(-aX + a^2/2),  the classical mean shift\n');

// --- A. exact reference against SciPy ---------------------------------------

const py = `
import sys
from scipy.stats import norm
for a in [${THRESHOLDS.join(', ')}]:
    print(repr(float(norm.sf(a))))
`;
let scipy = null;
try {
  const out = execFileSync('uv', ['run', '--quiet', '--with', 'scipy', 'python', '-c', py], {
    encoding: 'utf8',
  });
  scipy = out.trim().split('\n').map(Number);
} catch (err) {
  console.log('  (SciPy unavailable, skipping the external comparison)\n');
}

console.log('A. EXACT REFERENCE');
console.log('      a        normalTail(a)              SciPy norm.sf(a)          rel. diff');
for (let i = 0; i < THRESHOLDS.length; i++) {
  const a = THRESHOLDS[i];
  const mine = normalTail(a);
  if (scipy) {
    const ref = scipy[i];
    const rel = Math.abs(mine - ref) / ref;
    console.log(
      `   ${a.toFixed(1).padStart(4)}    ${mine.toExponential(15)}    ${ref.toExponential(15)}    ${rel.toExponential(2)}`
    );
  } else {
    console.log(`   ${a.toFixed(1).padStart(4)}    ${mine.toExponential(15)}`);
  }
}
if (scipy) {
  const worst = Math.max(
    ...THRESHOLDS.map((a, i) => Math.abs(normalTail(a) - scipy[i]) / scipy[i])
  );
  console.log(`\n   worst relative difference   ${worst.toExponential(2)}`);
  console.log('   The series/continued-fraction join sits at a = 1.5; both branches agree');
  console.log('   with SciPy to near double precision, so the dashed curve is not a fit.');
}

// --- B. estimators -----------------------------------------------------------

const N = 4_000_000;
console.log('\n' + '-'.repeat(78));
console.log(`B. ESTIMATORS, n = ${N.toLocaleString()} samples per threshold per method\n`);
const t0 = Date.now();
const sim = new RareTailSim({ seed: 'verify/raretail' });
const BATCH = 200_000;
for (let done = 0; done < N; done += BATCH) sim.advance(Math.min(BATCH, N - done));

console.log('      a       exact          crude MC        z        IS              z');
let maxZ = 0, crudeDied = null;
for (const e of sim.est) {
  const c = e.crude();
  const s = e.is();
  const zc = c ? (c.p - e.exact) / c.se : null;
  const zs = s ? (s.p - e.exact) / s.se : null;
  if (zs !== null && Number.isFinite(zs)) maxZ = Math.max(maxZ, Math.abs(zs));
  if (!c && crudeDied === null) crudeDied = e.exact;
  console.log(
    `   ${e.a.toFixed(1).padStart(4)}   ${e.exact.toExponential(3)}   ` +
      (c ? `${c.p.toExponential(3)}   ${zc >= 0 ? '+' : ''}${zc.toFixed(2).padStart(6)}` : `${'—'.padStart(9)}   ${'—'.padStart(6)}`) +
      `   ${s ? `${s.p.toExponential(3)}   ${zs >= 0 ? '+' : ''}${zs.toFixed(2).padStart(6)}` : '—'}`
  );
}

console.log(`\n   max |z| for the IS estimator        ${maxZ.toFixed(2)}`);
console.log(`   crude Monte Carlo returns nothing below p ≈ ${crudeDied ? crudeDied.toExponential(1) : 'n/a'}`);
console.log('   z is (estimate − exact) / standard error. Values inside about 2 are');
console.log('   consistent with an unbiased estimator; the point is that IS keeps');
console.log('   producing them at magnitudes where crude Monte Carlo has no output at all.');
console.log(`\nelapsed ${((Date.now() - t0) / 1000).toFixed(1)} s`);

// --- contract ---------------------------------------------------------------
// The exact reference is the dashed curve on Fig. 4, so it is the claim that
// matters most. SciPy may be absent in CI; when it is, the series and the
// continued fraction are compared across their join at a = 1.5 instead, which
// is weaker but still catches a broken branch.
console.log('\nCONTRACT');
if (scipy) {
  const worst = Math.max(
    ...THRESHOLDS.map((a, i) => Math.abs(normalTail(a) - scipy[i]) / scipy[i])
  );
  assertAtMost('exact reference vs SciPy, rel.', worst, 1e-12, '(measured 7.2e-15)');
} else {
  console.log('   note: SciPy unavailable, checking the internal join instead');
  const x = 1.5 / Math.SQRT2, x2 = x * x;
  let term = x, sum = x;
  for (let n = 1; n < 200; n++) { term *= (2 * x2) / (2 * n + 1); sum += term; }
  const viaSeries = 0.5 * (1 - (2 / Math.sqrt(Math.PI)) * Math.exp(-x2) * sum);
  assertAtMost('series/CF join at a = 1.5, rel.',
    Math.abs(viaSeries - normalTail(1.5)) / normalTail(1.5), 1e-12);
}
assertAtMost('max |z| for the IS estimator', maxZ, 4, '(measured 2.04)');
finish('verify-raretail');
