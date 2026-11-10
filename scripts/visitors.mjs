// Who has been reading the site: a terminal report from the visits database.
//
//   npm run visitors            last 30 days
//   npm run visitors -- 7       last 7 days
//
// Reads the D1 database "akshatvalse-visits" through wrangler, so it needs a
// one-time `npx wrangler@4.159.0 login`. Prints to the terminal only: the repo
// is public, so never commit this output. To keep your own visits out, open
// https://akshatvalse.com/?nolog=1 once in each browser you use.
import { execFileSync } from 'node:child_process';

const WRANGLER = 'wrangler@4.159.0';
const DB = 'akshatvalse-visits';
const TZ = 'America/Chicago';

const days = Number(process.argv[2] ?? 30);
if (!Number.isInteger(days) || days < 1 || days > 400) {
  console.error('Usage: npm run visitors -- [days, 1 to 400]');
  process.exit(1);
}
// Same format as the stored hour stamps, so string comparison is exact.
const since = new Date(Date.now() - days * 86400e3).toISOString().slice(0, 13) + ':00Z';

function query(sql) {
  let out;
  try {
    out = execFileSync('npx', ['--yes', WRANGLER, 'd1', 'execute', DB, '--remote', '--json', '--command', sql], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024,
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

// What kind of network an organisation name suggests. Word-bounded, so
// "Rutgers" is not "rUTGERS-at&t" and "Brandeis" is not "brAND". A guess from
// the name only: check the ASN when it matters.
const KINDS = [
  ['university', /\b(universit(y|ies|at|é|ä)|college|institute of technology|polytechnic|school of|academy|research network|internet2|janet|geant|edu(cation)?(al)? network|cern|max planck|national lab(oratory)?)\b/i],
  ['relay/scan', /\b(cloudflare|akamai|fastly|apple|icloud|google|microsoft|azure|zscaler|proofpoint|mimecast|barracuda|cisco umbrella|forcepoint|netskope)\b/i],
  ['cloud', /\b(amazon|aws|digitalocean|ovh|hetzner|linode|vultr|choopa|oracle|alibaba|tencent|contabo|scaleway|m247|datacamp|leaseweb|ionos)\b/i],
  ['home/mobile', /\b(comcast|charter|spectrum|at&t|att|verizon|cellco|t-mobile|tmobile|sprint|cox|centurylink|lumen|frontier|mediacom|windstream|altice|optimum|google fiber|starlink|space exploration|us cellular|vodafone|reliance jio|jio|bharti|airtel|british telecom|bt|sky|virgin media|deutsche telekom|telekom|orange|telefonica|movistar|rogers|bell canada|telus|shaw|optus|telstra|china mobile|china unicom|chinanet|kddi|ntt|softbank|sk broadband|korea telecom)\b/i],
];
const kindOf = (org) => (org ? (KINDS.find(([, re]) => re.test(org))?.[0] ?? '') : '');

const local = (ts) => new Date(ts).toLocaleString('en-US', { timeZone: TZ, month: 'short', day: 'numeric', hour: 'numeric' });
const pad = (s, n) => String(s ?? '').slice(0, n).padEnd(n);
function table(rows, cols) {
  if (!rows.length) { console.log('  (none)'); return; }
  console.log('  ' + cols.map(([, w, , title]) => pad(title ?? '', w)).join('  ').trimEnd());
  for (const r of rows) console.log('  ' + cols.map(([key, w, fmt]) => pad(fmt ? fmt(r[key], r) : r[key], w)).join('  ').trimEnd());
}

const where = `ts >= '${since}'`;
const [s] = query(`SELECT SUM(bot = 0) AS views, COUNT(DISTINCT CASE WHEN bot = 0 THEN org END) AS networks,
  COUNT(DISTINCT CASE WHEN bot = 0 THEN country END) AS countries, SUM(bot = 1) AS automated, SUM(bot = 2) AS prefetched
  FROM visits WHERE ${where}`);

console.log(`\nakshatvalse.com, last ${days} days (times in ${TZ}, to the hour)`);
console.log(`  ${s?.views ?? 0} page views by people, from ${s?.networks ?? 0} networks in ${s?.countries ?? 0} countries`);
console.log(`  ${s?.prefetched ?? 0} browser prefetches (may or may not have been opened); ${s?.automated ?? 0} automated fetches`);
console.log('  Kinds are guessed from the network name. "relay/scan" means the network says little: Apple Private Relay,');
console.log('  a corporate proxy, or an email security scanner opening a link you sent.');

console.log('\nNetworks, most page views first');
table(query(`SELECT org, asn, GROUP_CONCAT(DISTINCT country) AS countries, COUNT(*) AS views,
  COUNT(DISTINCT path) AS pages, MAX(ts) AS last FROM visits
  WHERE ${where} AND bot = 0 GROUP BY org, asn ORDER BY views DESC, last DESC LIMIT 40`), [
  ['org', 40, (o) => o ?? '(unknown)', 'network'], ['org', 11, kindOf, 'kind'], ['asn', 7, null, 'ASN'],
  ['countries', 9, null, 'country'], ['views', 5, null, 'views'], ['pages', 5, null, 'pages'], ['last', 14, local, 'last seen'],
]);

console.log('\nRecent page views');
table(query(`SELECT ts, org, country, path, referrer, device FROM visits
  WHERE ${where} AND bot = 0 ORDER BY ts DESC, id DESC LIMIT 40`), [
  ['ts', 14, local, 'hour'], ['org', 30, (o) => o ?? '(unknown)', 'network'], ['org', 11, kindOf, 'kind'],
  ['country', 2, null, 'cc'], ['path', 30, null, 'page'], ['referrer', 16, (r) => r ?? '(direct)', 'from'], ['device', 7, null, 'device'],
]);

console.log('\nPages');
table(query(`SELECT path, COUNT(*) AS views, COUNT(DISTINCT org) AS networks FROM visits
  WHERE ${where} AND bot = 0 GROUP BY path ORDER BY views DESC LIMIT 20`), [
  ['path', 40, null, 'page'], ['views', 6, null, 'views'], ['networks', 8, null, 'networks'],
]);

console.log('\nWhere people came from');
table(query(`SELECT COALESCE(referrer, '(direct)') AS referrer, COUNT(*) AS views FROM visits
  WHERE ${where} AND bot = 0 AND (referrer IS NULL OR referrer != 'internal')
  GROUP BY referrer ORDER BY views DESC LIMIT 20`), [
  ['referrer', 30, null, 'from'], ['views', 6, null, 'views'],
]);

console.log('\nAutomated fetches by network (crawlers; link previews mean someone shared a link)');
table(query(`SELECT org, COUNT(*) AS fetches, MAX(ts) AS last FROM visits
  WHERE ${where} AND bot = 1 GROUP BY org ORDER BY fetches DESC LIMIT 15`), [
  ['org', 40, (o) => o ?? '(unknown)', 'network'], ['fetches', 7, null, 'fetches'], ['last', 14, local, 'last seen'],
]);
console.log('');
