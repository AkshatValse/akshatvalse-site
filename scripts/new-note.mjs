/**
 * Scaffold a note.
 *
 * A note on this site is not just prose: it owes the reader a named result, a
 * constant checked against a closed form, a live figure, and a script that
 * grades it. scripts/lint-notes.mjs enforces that in CI. This writes the four
 * pieces so the cost of starting is an evening of mathematics rather than an
 * evening of plumbing.
 *
 *   node scripts/new-note.mjs probability-flow-ode-vs-reverse-sde
 *
 * Then: write the note, fill in the sim, set the tolerance in the verify
 * script, add the slug to FIGURE in gen-og-notes.mjs and to OWNED_BY in
 * lint-notes.mjs, and run `npm run verify && npm run og`.
 */

import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const slug = process.argv[2];

if (!slug || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
  console.error('usage: node scripts/new-note.mjs <kebab-case-slug>');
  process.exit(1);
}

const title = slug.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());
const today = new Date().toISOString().slice(0, 10);

const files = [
  [
    `src/content/notes/${slug}.md`,
    `---
title: ${title}
summary: One sentence. What is computed, and what closed form it is checked against.
date: ${today}
draft: true
---

Open with the question, not with a definition. What quantity is at stake, and
why is it usually not computable?

## Setting and assumptions

State them explicitly. Name the theorem when a result depends on one.

$$
% the object under study
$$

## The exact answer

Derive it. End with a number the simulation has to hit:

$$
% closed form = 0.000000
$$

## Checking a simulation against it

Quote the measured value, its standard error, and how far it sits from the
exact one. Do not smooth anything. If the estimator is slow or noisy, say so
and say why.

The [figure on the research page](/research) runs this live.

## References

- Author (year). Title. *Journal*.
`,
  ],
  [
    `src/sim/${slug.replace(/-/g, '')}.js`,
    `/**
 * ${title}.
 *
 * No DOM access here: the same module has to run in the browser, in
 * scripts/verify-${slug}.mjs, and in the build-time poster generator.
 */

import { makeRng } from './rng.js';

export const DEFAULTS = {
  seed: '${slug}/2026',
};

/** The closed form this simulation is graded against. */
export const EXACT = NaN; // TODO

export class Sim {
  constructor(opts = {}) {
    const o = { ...DEFAULTS, ...opts };
    const { rand, normal } = makeRng(o.seed);
    this.rand = rand;
    this.normal = normal;
    this.n = 0;
  }

  advance(steps) {
    // TODO
    this.n += steps;
  }

  /** Current estimate and its standard error. */
  estimate() {
    return { value: NaN, se: NaN };
  }
}
`,
  ],
  [
    `scripts/verify-${slug}.mjs`,
    `/**
 * Correctness check for ${title}.
 *
 * Claim under test: TODO.
 *
 * Run: node scripts/verify-${slug}.mjs
 */

import { Sim, EXACT } from '../src/sim/${slug.replace(/-/g, '')}.js';
import { assertNear, finish } from './assert.mjs';

console.log('${title} — check');
console.log('='.repeat(72));

const sim = new Sim({ seed: 'verify/${slug}' });
sim.advance(1_000_000);
const { value, se } = sim.estimate();

console.log(\`  exact      \${EXACT}\`);
console.log(\`  estimate   \${value} ± \${se}\`);

// --- contract ---------------------------------------------------------------
// Set the tolerance from the measured standard error: roughly three of them,
// so Monte Carlo noise cannot trip it but a real regression will. Record the
// measured value here so drift shows up in a diff.
console.log('\\nCONTRACT');
assertNear('estimate vs exact', value, EXACT, 3 * se, '(measured TODO)');
finish('verify-${slug}');
`,
  ],
];

let wrote = 0;
for (const [rel, contents] of files) {
  const abs = path.join(ROOT, rel);
  if (existsSync(abs)) {
    console.log(`  exists, left alone: ${rel}`);
    continue;
  }
  writeFileSync(abs, contents, 'utf8');
  console.log(`  wrote ${rel}`);
  wrote++;
}

console.log(`
${wrote} file(s) created. The note is marked draft: true, so it will not appear
on the site or in the feed until you remove that line.

Still to wire by hand, deliberately:
  1. scripts/lint-notes.mjs   OWNED_BY['${slug}'] = 'verify-${slug}.mjs'
  2. scripts/gen-og-notes.mjs FIGURE['${slug}'] = { kind, file }
  3. .github/workflows/verify.yml   add the new verify script
`);
