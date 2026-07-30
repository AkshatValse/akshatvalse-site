/**
 * The note contract, made mechanical.
 *
 * House style says a note earns its place by being checkable. This encodes
 * that as four requirements and fails the build when one is missing, so the
 * standard holds without anyone having to remember it.
 *
 *   1. a named theorem, formula or exact identity
 *   2. a computed constant compared against a closed form
 *   3. a live figure with a poster fallback, or a link to the page carrying one
 *   4. a verification script that owns its numbers
 *
 * Requirements 1 and 2 are checked by pattern, which is imperfect: it can be
 * satisfied by a note that merely looks rigorous. It cannot be satisfied by one
 * that contains no mathematics at all, which is the failure worth catching.
 *
 * Run: node scripts/lint-notes.mjs
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NOTES = path.join(ROOT, 'src', 'content', 'notes');
const SCRIPTS = path.join(ROOT, 'scripts');

/** Which verification script owns each note's numbers. */
const OWNED_BY = {
  'effective-diffusivity-cosine-potential': 'verify-diffusivity.mjs',
  'grading-a-diffusion-model': 'verify-diffusion.mjs',
  'what-the-metropolis-correction-buys': 'verify-gibbs.mjs',
};

/** Names a note may invoke; having one of these is evidence of requirement 1. */
const NAMED_RESULTS = [
  'Lifson', 'Kramers', 'Itô', 'Ito', 'Fredholm', 'Anderson', 'Jensen',
  'Euler', 'Girsanov', 'Sanov', 'Donsker', 'Freidlin', 'Cramér', 'Cramer',
  'Dupuis', 'Budhiraja', 'Bessel', 'Gibbs', 'Laplace', 'Ville',
];

let failures = 0;
const fail = (slug, msg) => { failures++; console.log(`   FAIL  ${slug}: ${msg}`); };
const pass = (slug, msg) => console.log(`   PASS  ${slug}: ${msg}`);

const files = readdirSync(NOTES).filter((f) => /\.mdx?$/.test(f));
if (!files.length) {
  console.log('no notes found');
  process.exit(1);
}

console.log('Note contract');
console.log('='.repeat(72));

for (const file of files) {
  const slug = file.replace(/\.mdx?$/, '');
  const src = readFileSync(path.join(NOTES, file), 'utf8');
  const body = src.replace(/^---[\s\S]*?---/, '');

  // 1. named result
  const named = NAMED_RESULTS.filter((n) => body.includes(n));
  named.length
    ? pass(slug, `names ${named.slice(0, 3).join(', ')}`)
    : fail(slug, 'no named theorem or identity');

  // 2. a constant compared against a closed form. Look for a display equation
  //    and a number with enough digits to be a comparison rather than a round
  //    figure quoted in passing.
  const hasDisplay = /\$\$[\s\S]+?\$\$/.test(body);
  const hasConstant = /\d\.\d{4,}/.test(body);
  hasDisplay && hasConstant
    ? pass(slug, 'has a display equation and a multi-digit constant')
    : fail(slug, `missing ${!hasDisplay ? 'a display equation' : 'a computed constant'}`);

  // 3. a live figure, or a link to the page that carries it
  /\]\(\/(research|)\)|\]\(\/research\)|\]\(\/\)/.test(body)
    ? pass(slug, 'links a page carrying a live figure')
    : fail(slug, 'does not reach a live figure');

  // 4. an owning verification script
  const owner = OWNED_BY[slug];
  if (!owner) fail(slug, 'no entry in OWNED_BY; add one and point it at a script');
  else if (!existsSync(path.join(SCRIPTS, owner))) fail(slug, `owner ${owner} does not exist`);
  else pass(slug, `numbers owned by ${owner}`);

  console.log('');
}

if (failures) {
  console.log(`${failures} contract violation(s)`);
  process.exit(1);
}
console.log(`all ${files.length} notes satisfy the contract`);
