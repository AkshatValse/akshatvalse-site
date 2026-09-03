/**
 * Compatibility no-op.
 *
 * The notes section was removed on 2026-09-03, and with it the note contract
 * this script used to enforce. The Cloudflare Pages build command (set in the
 * dashboard, not in this repo) may still invoke `node scripts/lint-notes.mjs`
 * or `npm run lint:notes`; this stub keeps that command from failing. Delete
 * it once the dashboard build command is `npm run verify:fast && npm run build`.
 */
console.log('lint-notes: notes section removed; nothing to check.');
