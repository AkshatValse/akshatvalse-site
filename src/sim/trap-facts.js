/**
 * Build-time facts about Fig. 1, computed from the same seeded run the page
 * replays, so no number quoted next to the figure is a hand-copied snapshot.
 * Imported by Astro components at build time only; nothing here ships.
 */

import {
  TrapScene, TrapEngine, GATES, PROTOCOL, LAMBDA_REF, DISPLAY_SEED, DISPLAY_CANDIDATES, FURTHER_SEEDS, BIN,
  displayPlan, drawSessions, toPlan, windowStats, burstEnd, followUpsAfter, hitFraction,
} from './trap.js';
import { costs, trapLimits } from './modelf.js';

let cached = null;

/** R1 rescue releases on the engine at 1.35 lambda_ref (paper, App. E: 4,550, 3,980 and 4,400 s). */
export const PAPER_RELEASE_RANGE = [3980, 4550];

/**
 * The no-cap arm of one seed: its window statistics and what happens after the
 * burst clears; with rescue, also when the R1 cap comes off.
 */
export function openArm(seed, { rescue = false } = {}) {
  const { base, burst } = drawSessions(seed, PROTOCOL.mult * LAMBDA_REF);
  const plan = toPlan([...base, ...burst]);
  const e = new TrapEngine(plan, GATES.none, { record: true });
  e.advanceTo(PROTOCOL.H);
  const be = burstEnd(e);
  const after = be.open === 0 ? followUpsAfter(e, be.last) : null;
  let release = null;
  if (rescue) {
    const r = new TrapEngine(plan, GATES.rescue);
    r.advanceTo(PROTOCOL.H);
    release = r.tRelease;
  }
  return { W: windowStats(e), cleared: be.open === 0, after, release };
}

/** Smallest of 50, 100, 150, ... at or above x. */
const niceCeil = (x) => Math.ceil(x / 50) * 50;

export function trapFacts() {
  if (cached) return cached;
  const plan = displayPlan();
  const H = PROTOCOL.H;
  const lam = PROTOCOL.mult * LAMBDA_REF;

  const scene = new TrapScene({ plan });
  scene.advanceTo(H);

  const open = new TrapEngine(plan, GATES.none, { record: true });
  open.advanceTo(H);
  const capped = new TrapEngine(plan, GATES.rescue, { record: true });
  capped.advanceTo(H);

  const W = windowStats(open);
  const be = burstEnd(open);
  const after = followUpsAfter(open, be.last);
  const tc = costs();
  const F = trapLimits(lam, tc);

  // When hits come back under the cap: the first bin after it engages whose
  // follow-up hit fraction is above 0.8.
  let hitsBack = null;
  scene.bins[1].forEach((b, i) => {
    const hf = hitFraction(b);
    if (hitsBack === null && (i + 1) * BIN > capped.tEngage && hf !== null && hf > 0.8) hitsBack = (i + 1) * BIN;
  });

  // When they hold: the start of the last unbroken run of bins, after the cap
  // engages, whose follow-up hit fraction is at least 0.8. Between hitsBack and
  // hitsHold the hits drop out again while the gate drains the backlog. The
  // paper's engine runs dip too, though less deeply (60 s minima of 0.13-0.60
  // there; this run reaches 0).
  let hitsHold = null;
  for (let i = scene.bins[1].length - 1; i >= 0; i--) {
    const hf = hitFraction(scene.bins[1][i]);
    if (i * BIN < capped.tEngage || (hf !== null && hf < 0.8)) break;
    hitsHold = i * BIN;
  }

  // The selection (see DISPLAY_SEED) and the claims checked beyond it.
  const candidates = DISPLAY_CANDIDATES.map((s) => openArm(s, { rescue: true }));
  const cleared = candidates.filter((r) => r.cleared);
  const inRange = cleared.filter((r) => r.release >= PAPER_RELEASE_RANGE[0] && r.release <= PAPER_RELEASE_RANGE[1]);
  const further = FURTHER_SEEDS.map((s) => openArm(s));
  const furtherCleared = further.filter((r) => r.cleared);
  const stuck = further.filter((r) => r.W.fuHit === 0);
  const compl = stuck.map((r) => r.W.completionRate / tc.lamMiss);

  // When the burst takes the hits away: the first bin after it starts whose
  // follow-up hit fraction is below 0.2, per lane.
  const hitsGone = scene.bins.map((bins) => {
    const i = bins.findIndex((b, k) => (k + 1) * BIN > PROTOCOL.tB && hitFraction(b) !== null && hitFraction(b) < 0.2);
    return i < 0 ? null : (i + 1) * BIN;
  });

  const ymax = niceCeil(Math.max(...scene.bins.flat().map((b) => b.n)));
  const last = (j) => scene.bins[j][scene.bins[j].length - 1];

  cached = {
    seed: DISPLAY_SEED, H, bin: BIN, ymax, bins: scene.bins,
    sessions: plan.arrival.length, burstN: PROTOCOL.burstN, tB: PROTOCOL.tB, burstW: PROTOCOL.burstW,
    mult: PROTOCOL.mult, lam, lamRef: LAMBDA_REF, lamMiss: tc.lamMiss, rho: F.rho,
    cap: GATES.rescue.cap, engage: capped.tEngage, release: capped.tRelease, hitsBack, hitsHold, hitsGone,
    baseSessions: plan.arrival.length - PROTOCOL.burstN,
    selection: {
      candidates: candidates.length, cleared: cleared.length, inRange: inRange.length,
      releaseRange: PAPER_RELEASE_RANGE,
    },
    further: {
      seeds: further.length,
      // Stuck: exactly zero follow-up hits over [5700, 8700) s.
      stuck: stuck.length,
      cleared: furtherCleared.length,
      clearedNoHitsAfter: furtherCleared.filter((r) => r.after.fu > 0 && r.after.hit === 0).length,
      // Pooled over the stuck runs, as scripts/verify-trap.mjs pools them.
      promptOverPz: stuck.reduce((a, r) => a + r.W.meanPrompt / F.Pserved, 0) / stuck.length,
      completionsOverMiss: compl.reduce((a, x) => a + x, 0) / compl.length,
      completionsMin: Math.min(...compl), completionsMax: Math.max(...compl),
    },
    window: PROTOCOL.window,
    trapped: {
      fuHit: W.fuHit, meanPrompt: W.meanPrompt, sessions: W.sessionsMean,
      completionsOverMiss: W.completionRate / tc.lamMiss,
    },
    lastBurst: be.last, burstOpen: be.open, followUpsAfterLastBurst: after.fu, hitsAfterLastBurst: after.hit,
    model: { z: F.z, Pz: F.Pserved, Pstat: F.Pstat, DoverMiss: F.DoverMiss, alpha: F.alpha },
    final: [
      { hit: hitFraction(last(0)), n: last(0).n },
      { hit: hitFraction(last(1)), n: last(1).n },
    ],
  };
  return cached;
}
