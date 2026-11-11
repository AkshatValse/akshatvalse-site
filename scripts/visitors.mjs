// Who has been reading the site: a terminal report from the visits database.
//
//   npm run visitors                      last 30 days
//   npm run visitors -- 7                 last 7 days
//   npm run visitors -- 30 --edu          university and research networks only
//   npm run visitors -- --org "iowa state"  one network's page views, in order,
//                                         with read time and the page it came from
//   npm run visitors -- --peek            do not update the "new networks" state
//
// Reads the D1 database "akshatvalse-visits" through wrangler, so it needs a
// one-time `npx wrangler@4.159.0 login`. Prints to the terminal only: the repo
// is public, so never commit this output, and never run this in CI (Actions
// logs on a public repo are public). To keep your own visits out, open
// https://akshatvalse.com/?nolog=1 once in each browser you use, or turn on
// Global Privacy Control.
//
// State and watch list, both outside version control:
//  - .visitors-state.json (git-ignored) remembers which networks earlier runs
//    saw, so that "new networks" can say which are new.
//  - a watch list of networks to highlight with "*": one case-insensitive name
//    fragment per line, '#' for comments, in ~/.config/akshatvalse/watchlist.txt
//    or the file named by $VISITORS_WATCHLIST. It may show where you are
//    applying, so the script refuses a watch list inside this repository.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  kindOf, isEdu, summarise, dwellByPage, DWELL_ORDER, newNetworks, networkKey, parseWatchlist, isWatched,
  timeline, safeOrgPattern, groupReads, isRelayOrCloud,
} from '../analytics/report.js';

const WRANGLER = 'wrangler@4.159.0';
const DB = 'akshatvalse-visits';
const TZ = 'America/Chicago';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const STATE = join(ROOT, '.visitors-state.json');

const { values: opt, positionals } = parseArgs({
  allowPositionals: true,
  options: { edu: { type: 'boolean' }, org: { type: 'string' }, peek: { type: 'boolean' } },
});
const days = Number(positionals[0] ?? 30);
if (!Number.isInteger(days) || days < 1 || days > 400) {
  console.error('Usage: npm run visitors -- [days, 1 to 400] [--edu] [--org "<pattern>"] [--peek]');
  process.exit(1);
}
const orgPattern = opt.org === undefined ? null : safeOrgPattern(opt.org);
if (opt.org !== undefined && !orgPattern) {
  console.error('--org takes 2 to 60 letters, digits, spaces and . , & \' ( ) / -');
  process.exit(1);
}
// Same format as the stored hour stamps, so string comparison is exact.
const since = new Date(Date.now() - days * 86400e3).toISOString().slice(0, 13) + ':00Z';

function query(sql) {
  let out;
  try {
    out = execFileSync('npx', ['--yes', WRANGLER, 'd1', 'execute', DB, '--remote', '--json', '--command', sql], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024,
    });
  } catch (e) {
    let why = null;
    try { why = JSON.parse(e.stdout || e.stderr)?.error?.text; } catch { /* not JSON */ }
    console.error(`Could not read the visits database: ${why ?? e.message}`);
    console.error(`If you are not logged in, run: npx ${WRANGLER} login`);
    process.exit(1);
  }
  return JSON.parse(out)[0]?.results ?? [];
}

const local = (ts) => new Date(ts).toLocaleString('en-US', { timeZone: TZ, month: 'short', day: 'numeric', hour: 'numeric' });
const pad = (s, n) => String(s ?? '').slice(0, n).padEnd(n);
function table(rows, cols) {
  if (!rows.length) { console.log('  (none)'); return; }
  console.log('  ' + cols.map(([, w, , title]) => pad(title ?? '', w)).join('  ').trimEnd());
  for (const r of rows) console.log('  ' + cols.map(([key, w, fmt]) => pad(fmt ? fmt(r[key], r) : r[key], w)).join('  ').trimEnd());
}

// The watch list, from outside the repository.
let watch = [];
{
  const file = resolve(process.env.VISITORS_WATCHLIST ?? join(homedir(), '.config', 'akshatvalse', 'watchlist.txt'));
  const rel = relative(ROOT, file);
  if (!rel.startsWith('..') && !isAbsolute(rel)) {
    console.error(`Ignoring the watch list ${file}: it is inside the repository, which is public. Move it elsewhere.`);
  } else if (existsSync(file)) {
    watch = parseWatchlist(readFileSync(file, 'utf8'));
  }
}
const star = (org) => (isWatched(org, watch) ? '*' : '');

const orgSql = orgPattern ? ` AND org LIKE '%${orgPattern}%'` : '';
let visits = query(`SELECT id, ts, path, country, org, asn, referrer, from_path, device, bot, bot_kind FROM visits
  WHERE ts >= '${since}'${orgSql} ORDER BY ts, id`);
let reads = query(`SELECT ts, path, country, org, asn, device, dwell, scroll FROM reads WHERE ts >= '${since}'${orgSql}`);
if (opt.edu) {
  visits = visits.filter((v) => isEdu(v.org));
  reads = reads.filter((r) => isEdu(r.org));
}
const isCv = (p) => /^\/akshat-valse-cv-\d{4}-\d{2}\.pdf$/.test(p);
const pageVisits = visits.filter((v) => !isCv(v.path));
const people = pageVisits.filter((v) => v.bot === 0);

console.log(`\nakshatvalse.com, last ${days} days (times in ${TZ}, to the hour)${opt.edu ? ', university and research networks only' : ''}${orgPattern ? `, networks matching "${opt.org}"` : ''}`);

// A timeline for one network, then stop.
if (orgPattern) {
  console.log('\nPage views in order (read = how long the page was visible; "from" is the page or site the reader came from)');
  table(timeline(visits, reads), [
    ['ts', 14, local, 'hour'], ['org', 26, null, 'network'], ['path', 28, null, 'page'],
    ['from', 18, (f) => f ?? '(direct)', 'from'], ['dwell', 7, (d) => d ?? '-', 'read'], ['scroll', 6, (s) => (s ? `${s}/4` : '-'), 'scroll'],
    ['kind', 10, (k, r) => (r.bot === 2 ? 'prefetch' : (k ?? '')), 'auto'],
  ]);
  console.log('');
  process.exit(0);
}

const s = summarise(pageVisits.filter((v) => v.bot !== 1), reads);
const networksOf = (rows) => new Set(rows.map((r) => networkKey(r))).size;
const readGroups = groupReads(reads).filter((r) => r.dwell !== '<10s' && !isRelayOrCloud(r.org));
console.log(`  ${s.reads} reads (a page visible for 10 s or more), from ${networksOf(readGroups)} networks in ${new Set(readGroups.map((r) => r.country)).size} countries`);
console.log(`  ${s.relayReads} more reads from relay, scanner and cloud networks, not counted above (a reader on a commercial VPN lands here)`);
console.log(`  ${s.loads} page loads by people, of which ${s.noBeacon} sent no beacon: a weaker signal, since the page may have been left quickly or scripts blocked`);
console.log(`  ${s.prefetched} browser prefetches, ${s.opened} of them later opened`);
console.log(`  ${visits.filter((v) => v.bot === 1).length} automated fetches (kinds below); ${visits.filter((v) => isCv(v.path) && v.bot === 0).length} CV downloads`);
console.log('  Kinds are guessed from the network name. "relay/scan" means the network says little: Apple Private Relay,');
console.log('  a corporate proxy, or an email security scanner opening a link you sent. "*" marks a network on your watch list.');

// Networks.
const byNet = new Map();
for (const v of people) {
  const k = networkKey(v);
  const n = byNet.get(k) ?? { org: v.org, asn: v.asn, countries: new Set(), views: 0, pages: new Set(), last: '' };
  n.views += 1; n.countries.add(v.country); n.pages.add(v.path); if (v.ts > n.last) n.last = v.ts;
  byNet.set(k, n);
}
const readsBy = new Map();
for (const r of groupReads(reads)) if (r.dwell !== '<10s') readsBy.set(networkKey(r), (readsBy.get(networkKey(r)) ?? 0) + 1);
const nets = [...byNet.entries()].map(([k, n]) => ({ ...n, key: k, countries: [...n.countries].join(','), pages: n.pages.size, reads: readsBy.get(k) ?? 0 }))
  .sort((a, b) => b.reads - a.reads || b.views - a.views || (a.last < b.last ? 1 : -1));
console.log('\nNetworks, most reads first');
table(nets.slice(0, 40), [
  ['org', 1, (o) => star(o), ''], ['org', 40, (o) => o ?? '(unknown)', 'network'], ['org', 11, kindOf, 'kind'], ['asn', 7, null, 'ASN'],
  ['countries', 9, null, 'country'], ['reads', 5, null, 'reads'], ['views', 5, null, 'views'], ['pages', 5, null, 'pages'], ['last', 14, local, 'last seen'],
]);

// Watch list.
if (watch.length) {
  console.log('\nOn your watch list');
  table(nets.filter((n) => isWatched(n.org, watch)), [
    ['org', 40, (o) => o ?? '(unknown)', 'network'], ['reads', 5, null, 'reads'], ['views', 5, null, 'views'], ['last', 14, local, 'last seen'],
  ]);
}

// New networks.
{
  let state = null;
  try { state = JSON.parse(readFileSync(STATE, 'utf8')); } catch { /* first run */ }
  console.log('\nNetworks seen for the first time since the last run');
  if (!state) console.log('  (first run: the state file is created now, so the next run can say which are new)');
  else table(newNetworks(nets, state.seen).sort((a, b) => (a.last < b.last ? 1 : -1)), [
    ['org', 1, (o) => star(o), ''], ['org', 40, (o) => o ?? '(unknown)', 'network'], ['org', 11, kindOf, 'kind'], ['views', 5, null, 'views'], ['last', 14, local, 'last seen'],
  ]);
  // A filtered or single-window run must not mark networks it did not look at as seen.
  if (!opt.peek && !opt.edu) {
    writeFileSync(STATE, JSON.stringify({ seen: [...new Set([...(state?.seen ?? []), ...nets.map((n) => n.key)])].sort(), updated: new Date().toISOString() }));
  }
}

// CV downloads.
console.log('\nCV downloads, by network');
const cv = new Map();
for (const v of visits.filter((x) => isCv(x.path) && x.bot === 0)) {
  const k = networkKey(v); const n = cv.get(k) ?? { org: v.org, n: 0, last: '' };
  n.n += 1; if (v.ts > n.last) n.last = v.ts; cv.set(k, n);
}
table([...cv.values()].sort((a, b) => b.n - a.n), [
  ['org', 1, (o) => star(o), ''], ['org', 40, (o) => o ?? '(unknown)', 'network'], ['n', 9, null, 'downloads'], ['last', 14, local, 'last'],
]);

// Read time per page.
console.log('\nRead time per page (one count per hour, page and network; visible time)');
table(dwellByPage(reads).sort((a, b) => DWELL_ORDER.reduce((t, k) => t + b[k] - a[k], 0)).slice(0, 20),
  [['path', 34, null, 'page'], ...DWELL_ORDER.map((b) => [b, 7, null, b])]);

console.log('\nPages (page views by people)');
const pages = new Map();
for (const v of people) { const p = pages.get(v.path) ?? { path: v.path, views: 0, nets: new Set() }; p.views += 1; p.nets.add(networkKey(v)); pages.set(v.path, p); }
table([...pages.values()].map((p) => ({ ...p, networks: p.nets.size })).sort((a, b) => b.views - a.views).slice(0, 20),
  [['path', 40, null, 'page'], ['views', 6, null, 'views'], ['networks', 8, null, 'networks']]);

console.log('\nHow readers move between pages (from this site\'s own pages)');
const moves = new Map();
for (const v of people.filter((x) => x.from_path)) { const k = `${v.from_path} -> ${v.path}`; moves.set(k, (moves.get(k) ?? 0) + 1); }
table([...moves.entries()].map(([move, n]) => ({ move, n })).sort((a, b) => b.n - a.n).slice(0, 15), [['move', 56, null, 'from -> to'], ['n', 5, null, 'times']]);

console.log('\nWhere people came from');
const refs = new Map();
for (const v of people.filter((x) => x.referrer !== 'internal')) refs.set(v.referrer ?? '(direct)', (refs.get(v.referrer ?? '(direct)') ?? 0) + 1);
table([...refs.entries()].map(([referrer, views]) => ({ referrer, views })).sort((a, b) => b.views - a.views).slice(0, 20),
  [['referrer', 30, null, 'from'], ['views', 6, null, 'views']]);

console.log('\nAutomated fetches by kind (assistant and preview mean a person asked about or shared the link)');
const kinds = new Map();
for (const v of visits.filter((x) => x.bot === 1)) kinds.set(v.bot_kind ?? '(before kinds were recorded)', (kinds.get(v.bot_kind ?? '(before kinds were recorded)') ?? 0) + 1);
table([...kinds.entries()].map(([kind, fetches]) => ({ kind, fetches })).sort((a, b) => b.fetches - a.fetches), [['kind', 34, null, 'kind'], ['fetches', 8, null, 'fetches']]);

console.log('\nAutomated fetches by network');
const auto = new Map();
for (const v of visits.filter((x) => x.bot === 1)) {
  const k = networkKey(v); const n = auto.get(k) ?? { org: v.org, fetches: 0, kinds: new Set(), last: '' };
  n.fetches += 1; if (v.bot_kind) n.kinds.add(v.bot_kind); if (v.ts > n.last) n.last = v.ts; auto.set(k, n);
}
table([...auto.values()].map((n) => ({ ...n, kinds: [...n.kinds].join(',') })).sort((a, b) => b.fetches - a.fetches).slice(0, 15), [
  ['org', 1, (o) => star(o), ''], ['org', 40, (o) => o ?? '(unknown)', 'network'], ['kinds', 24, null, 'kinds'], ['fetches', 7, null, 'fetches'], ['last', 14, local, 'last seen'],
]);
console.log('');
