/**
 * Tolerance assertions for the verification scripts.
 *
 * Every figure on the site quotes a number. These helpers turn each of those
 * quotes into a build-breaking contract: the achieved value is printed next to
 * the tolerance it had to meet, and a breach exits non-zero so CI and the
 * deploy both fail.
 *
 * Tolerances are set with headroom over the measured value, wide enough that
 * Monte Carlo noise alone will not trip them and tight enough that a real
 * regression will. The measured value at the time of writing is recorded in
 * each call site so drift is visible in a diff.
 */

let failures = 0;
let checks = 0;

/** Assert `value <= limit`. */
export function assertAtMost(label, value, limit, note = '') {
  checks++;
  const ok = Number.isFinite(value) && value <= limit;
  if (!ok) failures++;
  console.log(
    `   ${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(46)} ${fmt(value)} <= ${fmt(limit)}` +
      (note ? `   ${note}` : '')
  );
  return ok;
}

/** Assert `|value - target| <= tol`. */
export function assertNear(label, value, target, tol, note = '') {
  checks++;
  const diff = Math.abs(value - target);
  const ok = Number.isFinite(diff) && diff <= tol;
  if (!ok) failures++;
  console.log(
    `   ${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(46)} |${fmt(value)} - ${fmt(target)}| = ` +
      `${fmt(diff)} <= ${fmt(tol)}` + (note ? `   ${note}` : '')
  );
  return ok;
}

function fmt(v) {
  if (!Number.isFinite(v)) return String(v);
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-3 || a >= 1e5)) return v.toExponential(3);
  return v.toPrecision(6).replace(/\.?0+$/, '');
}

/** Print the tally and exit non-zero if anything failed. */
export function finish(name) {
  console.log('');
  if (failures) {
    console.log(`${name}: ${failures} of ${checks} assertions FAILED`);
    process.exit(1);
  }
  console.log(`${name}: all ${checks} assertions passed`);
}
