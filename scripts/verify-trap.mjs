/**
 * Correctness check for Fig. 1, the trap.
 *
 * Claims under test:
 *   1. The model-F numbers the page quotes are the paper's. z, alpha, P_z,
 *      D, H, Gamma and the mean served turn are recomputed from the cost model
 *      (whose decode share delta is taken from trap_renewal.trap_costs, which
 *      fixes lambda_miss) and checked against the predictions the paper froze
 *      before its blind tests (configs/icml_trap_predict.yaml in the paper's
 *      repository, cell a100_300k, the mult 1.35 row), and against the Perron
 *      equation and the identity D / lambda_miss = H Gamma of Theorem 2.
 *   2. The simulation in the browser is the paper's simulator. On the display
 *      plan, the JS engine reproduces the Python engine of the paper's
 *      repository (src/prefixmeta, configs/r6_predict.yaml with
 *      engine.batch_decode_iterations=false, its iteration-by-iteration path)
 *      exactly: the same turn, hit, iteration and eviction counts, release time
 *      and last completion time, in the three arms of the paired test E2 and in
 *      the R1 rescue run. scripts/trap-golden/ regenerates GOLDEN.
 *   3. Stepping the engine one simulated second at a time, as the page does,
 *      reaches the same state as running it in one call.
 *   4. The engine's own all-miss capacity agrees with model F's lambda_miss.
 *   5. The display run is TRAPPED by the full registered rule, NOBURST and
 *      CAPPED stay good and the R1 rescue releases and recovers. On 40 further
 *      seeds that played no part in choosing it, every BURST run is stuck at
 *      zero hits, NOBURST and CAPPED stay good and the rescue recovers; the full
 *      TRAPPED rule, backlog slope included, is counted rather than required.
 *   6. The graded number: in the trapped engine, the mean prompt of the turns
 *      served over [5700, 8700) s against model F's tilted mean P_z, on the
 *      display run and pooled over the further seeds. Model F is fitted to
 *      nothing in a trap; the stationary turn mix gives 10,469.
 *   7. The trap outlives its trigger. The display run was selected for having
 *      every burst session finish before the end; the check is that no
 *      follow-up turn hits the cache after the last one, there and in every
 *      further seed whose burst sessions all finish before the end.
 *   8. The numbers the pages quote (src/sim/trap-facts.js) are these.
 *
 * Run: node scripts/verify-trap.mjs
 */

import {
  TrapEngine, TrapScene, GATES, PROTOCOL, LAMBDA_REF, DISPLAY_SEED, DISPLAY_CANDIDATES, FURTHER_SEEDS, WORKLOAD, BIN,
  drawSessions, toPlan, ln, windowStats, burstEnd, followUpsAfter, hitFraction, ENGINE,
} from '../src/sim/trap.js';
import { costs, trapLimits, phiMinusOne } from '../src/sim/modelf.js';
import { trapFacts, PAPER_RELEASE_RANGE } from '../src/sim/trap-facts.js';
import { makeRng } from '../src/sim/rng.js';
import { assertAtMost, finish } from './assert.mjs';

const t0 = Date.now();
const H = PROTOCOL.H;
const lam = PROTOCOL.mult * LAMBDA_REF;

// --- 1. model F ---------------------------------------------------------------
const tc = costs();
const F = trapLimits(lam, tc);
// configs/icml_trap_predict.yaml, a100_300k: lambda_miss_model, and the mult 1.35
// row's rho, z, alpha, P_served_mean, D_over_lam_ref, H_T, C_c, k_served_mean.
const FROZEN = {
  lamMiss: 0.07184, rho: 1.3443, z: 1.013034, alpha: 0.015677, Pserved: 9324.1,
  DoverRef: 1.1308, H: 0.9928, Gamma: 1.1343, kServed: 12.268,
};

console.log('Model F, A100 300k cell, at 1.35 lambda_ref');
console.log(`   lambda      ${lam.toFixed(6)} sessions/s   (lambda_ref ${LAMBDA_REF})`);
console.log(`   lambda_miss ${tc.lamMiss.toFixed(8)}         rho ${F.rho.toFixed(4)}`);
console.log(`   z           ${F.z.toFixed(9)}         gamma ${F.gamma.toFixed(6)}`);
console.log(`   alpha       ${F.alpha.toFixed(6)} /s           D/lambda_miss ${F.DoverMiss.toFixed(4)} = H ${F.H.toFixed(4)} x Gamma ${F.Gamma.toFixed(4)}`);
console.log(`   P_z         ${F.Pserved.toFixed(2)} tokens     stationary mix ${F.Pstat.toFixed(2)}   served turn ${F.kServed.toFixed(3)}`);

// --- 2-3. the engine against the paper's Python engine -------------------------
// From scripts/trap-golden/ (see its README): export-plans.mjs writes the display
// plans, python_engine.py runs them through src/prefixmeta at the paper
// repository's 65c862d with configs/r6_predict.yaml and
// engine.batch_decode_iterations=false (noburst and burst through simulate_gate
// with an inert rescue gate, capped with the static cap 20, rescue with the R1
// gate). Run 2026-11-08; every completion time, not only the last, was identical.
const GOLDEN = {
  noburst: { turns: 12863, hits: 12021, iterations: 575894, evictions: 0, release: null, last: 8699.404711883224 },
  burst: { turns: 12436, hits: 1872, iterations: 112638, evictions: 9747, release: null, last: 8699.833244439167 },
  capped: { turns: 15721, hits: 14678, iterations: 578973, evictions: 0, release: null, last: 8699.999347904415 },
  rescue: { turns: 15720, hits: 12764, iterations: 491286, evictions: 1914, release: 4070, last: 8699.404711883224 },
};

function arms(seed) {
  const { base, burst } = drawSessions(seed, lam);
  const pB = toPlan([...base, ...burst]), pN = toPlan(base);
  const run = (plan, gate) => { const e = new TrapEngine(plan, gate, { record: true }); e.advanceTo(H); return e; };
  return { noburst: run(pN, GATES.none), burst: run(pB, GATES.none), capped: run(pB, GATES.capped), rescue: run(pB, GATES.rescue), pB };
}

const disp = arms(DISPLAY_SEED);
const counts = (e) => ({ turns: e.nTurnsDone, hits: e.nHits, iterations: e.nIterations, evictions: e.nEvictions, release: e.tRelease, last: e.lastDoneT });
let mismatches = 0;
console.log(`\nDisplay run ${DISPLAY_SEED}: ${disp.pB.arrival.length} sessions (${PROTOCOL.burstN} in the burst)`);
for (const arm of Object.keys(GOLDEN)) {
  const c = counts(disp[arm]), g = GOLDEN[arm];
  const bad = Object.keys(g).filter((k) => c[k] !== g[k]);
  mismatches += bad.length;
  console.log(`   ${arm.padEnd(8)} turns ${c.turns}  hits ${c.hits}  iterations ${c.iterations}  evictions ${c.evictions}` +
    `  release ${c.release ?? '-'}  last ${c.last}  ${bad.length ? 'DIFFERS in ' + bad.join(', ') : '= Python'}`);
}

// The page's path: a scene stepped once per simulated second.
const scene = new TrapScene({ plan: disp.pB });
scene.advanceTo(H);
let chunkMismatch = 0;
for (const [j, arm] of [[0, 'burst'], [1, 'rescue']]) {
  const a = counts(scene.engines[j]), b = counts(disp[arm]);
  for (const k of Object.keys(a)) if (a[k] !== b[k]) chunkMismatch++;
}
const binsExpected = H / BIN;

// --- 4. the engine's own all-miss capacity -------------------------------------
// Closed population of 32 sessions with prefix caching off, measured turns-based
// over [900, 2700) s like the paper's E0a runs.
function allMiss(seed) {
  const r = makeRng(`${seed}/closed`).rand;
  const sess = [];
  for (let i = 0; i < 6000; i++) {
    let T = 1; while (T < WORKLOAD.maxTurns && r() >= WORKLOAD.pEnd) T++;
    const z = []; for (let j = 0; j < T - 1; j++) z.push(-WORKLOAD.toolMean * ln(1 - r()));
    sess.push({ a: i < 32 ? 0 : Infinity, burst: false, T, z });
  }
  const e = new TrapEngine(toPlan(sess), GATES.none, { eng: { ...ENGINE, cache: false }, record: true, closed: true });
  e.advanceTo(2700);
  let turns = 0, tok = 0;
  for (const d of e.done) if (d[0] >= 900 && d[0] < 2700) { turns++; tok += d[4]; }
  return { sessions: turns / 1800 / tc.ET, tokens: tok / 1800 };
}
const am = [0, 1, 2].map((s) => allMiss(`verify/trap/allmiss/${s}`));
const engMiss = am.reduce((a, x) => a + x.sessions, 0) / am.length;
const engMissTok = am.reduce((a, x) => a + x.tokens, 0) / am.length;
console.log(`\nAll-miss capacity of the engine (32 sessions, cache off): ${engMiss.toFixed(5)} sessions/s, ` +
  `${engMissTok.toFixed(0)} uncached tok/s; model F ${tc.lamMiss.toFixed(5)}`);

// --- 5-7. protocol verdicts and the graded number ------------------------------
// The TRAPPED rule's token reference is the cell's measured all-miss rate; for
// the simulated cell that is the simulator's own (engMissTok above).
function verdicts(a) {
  const B = windowStats(a.burst), N = windowStats(a.noburst), C = windowStats(a.capped), R = windowStats(a.rescue);
  const R300 = windowStats(a.rescue, [H - 300, H]);
  let outstanding = 0;
  for (let i = 0; i < a.rescue.n; i++) if (a.rescue.plan.arrival[i] < H && Number.isNaN(a.rescue.tDone[i])) outstanding++;
  const trapped = B.fuHit < 0.2
    && Math.abs(B.uncachedRate / engMissTok - 1) <= 0.15
    && B.sessionsSlope > 0.5 * (lam - LAMBDA_REF);
  const be = burstEnd(a.burst);
  return {
    B, N, C, R, trapped, good: N.fuHit > 0.8, capped: C.fuHit > 0.8,
    rescued: a.rescue.tRelease !== null && R300.fuHit > 0.8 && outstanding < 20,
    release: a.rescue.tRelease, be, after: be.open === 0 ? followUpsAfter(a.burst, be.last) : null,
  };
}
const dv = verdicts(disp);
const be = dv.be, after = dv.after;
// The capped lane's last bin below 0.8 hits after the cap engages. The paper's
// R1 runs, in 60 s bins: "the last bin below 0.8 began 780-1620 s after the
// engage". lastLow uses the page's 30 s bins (it fixes hitsHold); lastLow60
// pairs them into 60 s bins for the comparison with the paper.
let lastLow = null, lastLow60 = null;
scene.bins[1].forEach((b, i) => {
  const hf = hitFraction(b);
  if (i * BIN >= disp.rescue.tEngage && hf !== null && hf < 0.8) lastLow = i * BIN;
});
for (let i = 0; i + 1 < scene.bins[1].length; i += 2) {
  const a = scene.bins[1][i], b = scene.bins[1][i + 1];
  const fu = a.fu + b.fu, hf = fu > 0 ? (a.hit + b.hit) / fu : null;
  if (i * BIN >= disp.rescue.tEngage && hf !== null && hf < 0.8) lastLow60 = i * BIN;
}
console.log(`\nDisplay run over [${PROTOCOL.window.join(', ')}) s`);
console.log(`   no cap     follow-up hits ${dv.B.fuHit.toFixed(3)}  sessions ${dv.B.sessionsMean.toFixed(0)} (slope ${dv.B.sessionsSlope.toFixed(4)}/s)` +
  `  uncached ${dv.B.uncachedRate.toFixed(0)} tok/s  completions ${(dv.B.completionRate / tc.lamMiss).toFixed(3)} lambda_miss`);
console.log(`              mean served prompt ${dv.B.meanPrompt.toFixed(0)} = ${(dv.B.meanPrompt / F.Pserved).toFixed(4)} P_z`);
console.log(`   rescue     engaged ${disp.rescue.tEngage} s, last bin below 0.8 hits starts ${lastLow} s ` +
  `(60 s bins: ${lastLow60} s), released ${dv.release} s, ` +
  `follow-up hits ${dv.R.fuHit.toFixed(3)}`);
console.log(`   no burst   follow-up hits ${dv.N.fuHit.toFixed(3)};  static cap ${dv.C.fuHit.toFixed(3)}`);
console.log(`   burst sessions: ${be.open} open at ${H} s, last finished at ${be.last.toFixed(0)} s; ` +
  `${after ? after.fu : '-'} follow-up turns after it, ${after ? after.hit : '-'} hits`);

// Stuck here means exactly zero follow-up hits over the window, which is what
// the pages say; the registered criterion is below 0.2.
let consistent = 0, ruleMet = 0, Psum = 0, Dsum = 0, nStuck = 0, cleared = 0, clearedClean = 0;
const furtherD = [];
for (const seed of FURTHER_SEEDS) {
  const v = verdicts(arms(seed));
  if (v.B.fuHit === 0 && v.good && v.capped && v.rescued) consistent++;
  if (v.trapped) ruleMet++;
  if (v.B.fuHit === 0) {
    nStuck++; Psum += v.B.meanPrompt / F.Pserved;
    const d = v.B.completionRate / tc.lamMiss; Dsum += d; furtherD.push(d);
  }
  if (v.after) { cleared++; if (v.after.fu > 0 && v.after.hit === 0) clearedClean++; }
}
const NV = FURTHER_SEEDS.length;
const pooledP = Psum / nStuck, pooledD = Dsum / nStuck;

// The selection of the display run, recomputed from its candidates.
let candCleared = 0, candInRange = 0;
for (const seed of DISPLAY_CANDIDATES) {
  const { base, burst } = drawSessions(seed, lam);
  const plan = toPlan([...base, ...burst]);
  const e = new TrapEngine(plan, GATES.none); e.advanceTo(H);
  if (burstEnd(e).open !== 0) continue;
  candCleared++;
  const r = new TrapEngine(plan, GATES.rescue); r.advanceTo(H);
  if (r.tRelease >= PAPER_RELEASE_RANGE[0] && r.tRelease <= PAPER_RELEASE_RANGE[1]) candInRange++;
}
console.log(`\n${NV} further seeds: in ${consistent}, BURST is stuck at zero hits, NOBURST and CAPPED stay good and ` +
  `the rescue recovers;\n   the full TRAPPED rule, backlog slope included, is met by ${ruleMet} ` +
  `(on the paper's engines at 1.35 lambda_ref: 5 of 9, and 2 of 3 in this cell; 23 of 30 over all ten rates)`);
console.log(`   pooled over ${nStuck} stuck runs: mean served prompt ${pooledP.toFixed(4)} P_z, ` +
  `completions ${pooledD.toFixed(3)} lambda_miss`);
console.log(`   burst sessions all finish before ${H} s in ${cleared}; no follow-up hit after the last one in ${clearedClean}`);

// --- 8. what the pages quote -----------------------------------------------------
// Every number trap-facts hands the pages, recomputed here independently.
const facts = trapFacts();
const firstBin = (bins, from, test) => {
  const i = bins.findIndex((b, k) => (k + 1) * BIN > from && hitFraction(b) !== null && test(hitFraction(b)));
  return i < 0 ? null : (i + 1) * BIN;
};
const near = (a, b) => Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(b));
const factChecks = {
  meanPrompt: facts.trapped.meanPrompt === dv.B.meanPrompt,
  sessions: facts.trapped.sessions === dv.B.sessionsMean,
  completionsOverMiss: near(facts.trapped.completionsOverMiss, dv.B.completionRate / tc.lamMiss),
  fuHit: facts.trapped.fuHit === dv.B.fuHit,
  release: facts.release === dv.release,
  engage: facts.engage === disp.rescue.tEngage,
  lastBurst: facts.lastBurst === be.last,
  hitsGone: facts.hitsGone[0] === firstBin(scene.bins[0], PROTOCOL.tB, (h) => h < 0.2)
    && facts.hitsGone[1] === firstBin(scene.bins[1], PROTOCOL.tB, (h) => h < 0.2),
  hitsBack: facts.hitsBack === firstBin(scene.bins[1], disp.rescue.tEngage, (h) => h > 0.8),
  hitsHold: facts.hitsHold === lastLow + BIN,
  baseSessions: facts.baseSessions === drawSessions(DISPLAY_SEED, lam).base.length,
  Pz: facts.model.Pz === F.Pserved, Pstat: facts.model.Pstat === F.Pstat, DoverMiss: facts.model.DoverMiss === F.DoverMiss,
  selCleared: facts.selection.cleared === candCleared, selInRange: facts.selection.inRange === candInRange,
  furtherStuck: facts.further.stuck === nStuck, furtherCleared: facts.further.cleared === cleared,
  furtherClean: facts.further.clearedNoHitsAfter === clearedClean,
  furtherP: near(facts.further.promptOverPz, pooledP), furtherD: near(facts.further.completionsOverMiss, pooledD),
  furtherDmin: facts.further.completionsMin === Math.min(...furtherD),
  furtherDmax: facts.further.completionsMax === Math.max(...furtherD),
};
const factFailed = Object.keys(factChecks).filter((k) => !factChecks[k]);
if (factFailed.length) console.log(`\npage facts differing: ${factFailed.join(', ')}`);
console.log(`\nselection: ${candCleared} of ${DISPLAY_CANDIDATES.length} candidates clear the burst, ` +
  `${candInRange} of them release inside ${PAPER_RELEASE_RANGE.join('-')} s`);
console.log(`\nelapsed ${((Date.now() - t0) / 1000).toFixed(1)} s`);

// --- contract ------------------------------------------------------------------
// Measured 2026-11-08. Model F agrees with the frozen file to its printed
// precision; the engine matches Python exactly. The display run: P/P_z 0.9925,
// completions 1.118 lambda_miss, release 4070 s, last low bin 1110 s after the
// engage (1080 s in 60 s bins). Further seeds: 40 of 40 consistent (BURST at
// exactly zero hits, NOBURST and CAPPED good, rescue recovered), TRAPPED rule
// met by 24, pooled P/P_z 1.028 and completions 1.117 lambda_miss (0.95 to
// 1.31), burst cleared in 10 with no hits after in all 10.
console.log('\nCONTRACT');
assertAtMost('|phi(z) - 1| at the Perron root', Math.abs(phiMinusOne(lam, F.z, tc)), 1e-12);
assertAtMost('|D/lambda_miss - H Gamma|', Math.abs(F.DoverMiss - F.H * F.Gamma), 1e-12);
assertAtMost('|lambda_miss - frozen 0.07184|', Math.abs(tc.lamMiss - FROZEN.lamMiss), 5e-6);
assertAtMost('|rho - frozen 1.3443|', Math.abs(F.rho - FROZEN.rho), 5e-5);
assertAtMost('|z - frozen 1.013034|', Math.abs(F.z - FROZEN.z), 5e-7);
assertAtMost('|alpha - frozen 0.015677|', Math.abs(F.alpha - FROZEN.alpha), 5e-7);
assertAtMost('|P_z - frozen 9324.1|', Math.abs(F.Pserved - FROZEN.Pserved), 0.05);
assertAtMost('|D/lambda_ref - frozen 1.1308|', Math.abs(F.D / LAMBDA_REF - FROZEN.DoverRef), 5e-5);
assertAtMost('|H - frozen 0.9928|', Math.abs(F.H - FROZEN.H), 5e-5);
assertAtMost('|Gamma - frozen 1.1343|', Math.abs(F.Gamma - FROZEN.Gamma), 5e-5);
assertAtMost('|served turn - frozen 12.268|', Math.abs(F.kServed - FROZEN.kServed), 5e-4);
let lnErr = 0;
for (let i = 1; i <= 100000; i++) { const x = i / 100001; lnErr = Math.max(lnErr, Math.abs(ln(x) - Math.log(x)) / Math.abs(Math.log(x))); }
assertAtMost('max rel |ln(x) - Math.log(x)| on (0, 1)', lnErr, 2e-15, '(measured 6.9e-16)');
assertAtMost('counts differing from the Python engine', mismatches, 0, '(24 compared)');
assertAtMost('per-second stepping vs one call, differences', chunkMismatch, 0);
assertAtMost('|bins drawn - H/30|, both lanes', Math.abs(scene.bins[0].length - binsExpected) + Math.abs(scene.bins[1].length - binsExpected), 0);
assertAtMost('|engine all-miss / lambda_miss - 1|', Math.abs(engMiss / tc.lamMiss - 1), 0.04, '(measured 0.0023)');
assertAtMost('display, no cap: follow-up hit fraction', dv.B.fuHit, 0.2, '(stuck below 0.2)');
assertAtMost('display, no cap: not TRAPPED by the full rule', dv.trapped ? 0 : 1, 0);
assertAtMost('display, no burst: 1 - hit fraction', 1 - dv.N.fuHit, 0.2);
assertAtMost('display, static cap: 1 - hit fraction', 1 - dv.C.fuHit, 0.2);
assertAtMost('display, rescue: not released and recovered', dv.rescued ? 0 : 1, 0);
assertAtMost('display, rescue: last low 60 s bin outside 780-1620 s', lastLow60 !== null && lastLow60 - disp.rescue.tEngage >= 780 && lastLow60 - disp.rescue.tEngage <= 1620 ? 0 : 1, 0, '(measured 1080 s)');
assertAtMost('display: |mean served prompt / P_z - 1|', Math.abs(dv.B.meanPrompt / F.Pserved - 1), 0.05, '(measured 0.0075)');
assertAtMost('display: burst sessions still open at H', be.open, 0, '(selected for)');
assertAtMost('display: hits after the last burst session', after && after.fu > 0 ? after.hit : 1, 0);
assertAtMost(`further seeds with an arm off the protocol, of ${NV}`, NV - consistent, 0, '(BURST at exactly zero hits)');
assertAtMost(`further seeds short of the full TRAPPED rule, of ${NV}`, NV - ruleMet, 28, '(measured 16)');
assertAtMost('further, pooled |mean served prompt / P_z - 1|', Math.abs(pooledP - 1), 0.05, '(measured 0.028)');
assertAtMost('further, pooled |completions / (H Gamma lambda_miss) - 1|', Math.abs(pooledD / F.DoverMiss - 1), 0.08);
assertAtMost('further, pooled youth premium: 1 - completions/lambda_miss', 1 - pooledD, 0);
assertAtMost('further, burst cleared: runs with hits after it', cleared - clearedClean, 0, `(${cleared} cleared)`);
assertAtMost('further, burst cleared in fewer than 4 runs', cleared >= 4 ? 0 : 1, 0, '(measured 10)');
assertAtMost('page facts differing from this run', factFailed.length, 0, `(${Object.keys(factChecks).length} compared)`);
finish('verify-trap');
