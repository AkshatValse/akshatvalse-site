/**
 * Writes the display run's session plans, and what the JS engine does with
 * them, for the cross-check against the paper's Python engine
 * (python_engine.py next to this file; see README.md).
 *
 * Run: node scripts/trap-golden/export-plans.mjs [outDir]
 *      (default outDir: <os tmpdir>/trap-golden)
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  TrapEngine, GATES, PROTOCOL, LAMBDA_REF, DISPLAY_SEED, drawSessions, toPlan,
} from '../../src/sim/trap.js';

const out = process.argv[2] ?? path.join(tmpdir(), 'trap-golden');
mkdirSync(out, { recursive: true });

const { base, burst } = drawSessions(DISPLAY_SEED, PROTOCOL.mult * LAMBDA_REF);
const plans = { noburst: toPlan(base), b: toPlan([...base, ...burst]) };
for (const [k, p] of Object.entries(plans)) {
  writeFileSync(path.join(out, `plan_${k}.json`),
    JSON.stringify({ arrival: p.arrival, n_turns: p.nTurns, tool_off: p.toolOff, tool_flat: p.toolFlat }));
}

const js = {};
for (const [arm, gate] of [['noburst', GATES.none], ['burst', GATES.none], ['capped', GATES.capped], ['rescue', GATES.rescue]]) {
  const e = new TrapEngine(arm === 'noburst' ? plans.noburst : plans.b, gate, { record: true });
  e.advanceTo(PROTOCOL.H);
  js[arm] = {
    n_turns_done: e.nTurnsDone, n_hits: e.nHits, n_iterations: e.nIterations, n_evictions: e.nEvictions,
    t_release: e.tRelease, last_done_t: e.lastDoneT, done_t: e.done.map((d) => d[0]),
  };
}
writeFileSync(path.join(out, 'js.json'), JSON.stringify(js));
console.log(`wrote plans and JS results for ${DISPLAY_SEED} to ${out}`);
