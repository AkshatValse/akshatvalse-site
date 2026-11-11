/**
 * The rules behind scripts/visitors.mjs, as pure functions so they can be
 * tested (analytics/report.test.mjs). The script fetches rows with wrangler
 * and prints; the decisions of what counts as a read, a person's network or a
 * new network live here. Nothing here reads or writes anything.
 */

/** What kind of network an organisation name suggests. Word-bounded, so
 *  "Rutgers" is not "rUTGERS-at&t" and "Brandeis" is not "brAND". A guess from
 *  the name only: check the ASN when it matters. */
export const KINDS = [
  ['university', /\b(universit(y|ies|at|é|ä)|college|institute of technology|polytechnic|school of|academy|research network|internet2|janet|geant|edu(cation)?(al)? network|cern|max planck|national lab(oratory)?)\b/i],
  ['relay/scan', /\b(cloudflare|akamai|fastly|apple|icloud|google|microsoft|azure|zscaler|proofpoint|mimecast|barracuda|cisco umbrella|forcepoint|netskope)\b/i],
  ['cloud', /\b(amazon|aws|digitalocean|ovh|hetzner|linode|vultr|choopa|oracle|alibaba|tencent|contabo|scaleway|m247|datacamp|leaseweb|ionos)\b/i],
  ['home/mobile', /\b(comcast|charter|spectrum|at&t|att|verizon|cellco|t-mobile|tmobile|sprint|cox|centurylink|lumen|frontier|mediacom|windstream|altice|optimum|google fiber|starlink|space exploration|us cellular|vodafone|reliance jio|jio|bharti|airtel|british telecom|bt|sky|virgin media|deutsche telekom|telekom|orange|telefonica|movistar|rogers|bell canada|telus|shaw|optus|telstra|china mobile|china unicom|chinanet|kddi|ntt|softbank|sk broadband|korea telecom)\b/i],
];

export const kindOf = (org) => (org ? (KINDS.find(([, re]) => re.test(org))?.[0] ?? '') : '');

/** University and research networks. */
export const isEdu = (org) => kindOf(org) === 'university';

/** Networks that say little about a reader: relays, scanners, clouds. A reader
 *  on a commercial VPN lands here and is anonymous in any case. They are left
 *  out of the headline count and listed on their own line. No network is
 *  excluded by name or number. */
export const isRelayOrCloud = (org) => ['relay/scan', 'cloud'].includes(kindOf(org));

const HOUR = 3600e3;
const hourMs = (ts) => Date.parse(ts.replace(/Z$/, ':00Z'));

/** A read needs at least 10 s visible: every dwell bucket but the first. */
const BUCKET_ORDER = ['<10s', '10-30s', '30s-2m', '2-5m', '5-15m', '>15m'];
const rank = (b) => BUCKET_ORDER.indexOf(b);

/** One entry per (hour, page, network, device): the largest dwell bucket and
 *  the deepest scroll of its beacons, since the beacon is cumulative. */
export function groupReads(rows) {
  const m = new Map();
  for (const r of rows) {
    const k = [r.ts, r.path, r.org, r.asn, r.device].join('\u0001');
    const g = m.get(k);
    if (!g) m.set(k, { ...r });
    else {
      if (rank(r.dwell) > rank(g.dwell)) g.dwell = r.dwell;
      if (r.scroll > g.scroll) g.scroll = r.scroll;
    }
  }
  return [...m.values()];
}

/** Whether a read (grouped) belongs to a visit: same page, network and device,
 *  in the visit's hour or the next one (the beacon comes when the page closes). */
function matches(visit, read) {
  if (visit.path !== read.path || visit.org !== read.org || visit.asn !== read.asn || visit.device !== read.device) return false;
  const d = hourMs(read.ts) - hourMs(visit.ts);
  return d === 0 || d === HOUR;
}

/**
 * The counts for the top of the report.
 *  reads        page loads by people that a beacon says were visible for 10 s
 *               or more, from networks that are not relays or clouds
 *  relayReads   the same, from relay, scanner and cloud networks
 *  noBeacon     page loads by people with no beacon (the page was not left
 *               visibly, or the script did not run): a weaker signal
 *  prefetch     browser prefetches, and how many of them were later opened
 * `visits` are rows with bot = 0 or 2; `reads` are raw read rows.
 */
export function summarise(visits, reads) {
  const grouped = groupReads(reads);
  let loads = 0, readCount = 0, relayReads = 0, noBeacon = 0, prefetched = 0, opened = 0;
  const people = visits.filter((v) => v.bot === 0);
  for (const v of people) {
    loads += 1;
    if (!grouped.some((r) => matches(v, r))) noBeacon += 1;
  }
  // Reads are counted from beacons, not from visits: a beacon is the evidence.
  for (const r of grouped) {
    if (rank(r.dwell) < rank('10-30s')) continue;
    if (isRelayOrCloud(r.org)) relayReads += 1; else readCount += 1;
  }
  for (const v of visits.filter((x) => x.bot === 2)) {
    prefetched += 1;
    if (grouped.some((r) => matches(v, r))) opened += 1;
  }
  return { loads, reads: readCount, relayReads, noBeacon, prefetched, opened };
}

/** Counts per dwell bucket for each page, in bucket order. */
export function dwellByPage(reads) {
  const pages = new Map();
  for (const r of groupReads(reads)) {
    const row = pages.get(r.path) ?? Object.fromEntries(BUCKET_ORDER.map((b) => [b, 0]));
    row[r.dwell] += 1;
    pages.set(r.path, row);
  }
  return [...pages.entries()].map(([path, buckets]) => ({ path, ...buckets }));
}

export const DWELL_ORDER = BUCKET_ORDER;

/** The key that names a network: its ASN, or its name when it has none. */
export const networkKey = (r) => (r.asn != null ? `AS${r.asn}` : `org:${r.org ?? ''}`);

/** Networks in `current` that are not in the state's `seen` list. */
export function newNetworks(current, seen) {
  const known = new Set(seen ?? []);
  return current.filter((n) => !known.has(networkKey(n)));
}

/** Parse the watch list file: one pattern per line, '#' starts a comment. */
export function parseWatchlist(text) {
  return String(text ?? '')
    .split(/\r?\n/)
    .map((l) => l.replace(/#.*$/, '').trim().toLowerCase())
    .filter(Boolean);
}

/** A network is watched if its name contains any watch-list pattern. */
export function isWatched(org, patterns) {
  const o = (org ?? '').toLowerCase();
  return Boolean(o) && patterns.some((p) => o.includes(p));
}

/** One network's page views in order, each with its read time and the page the
 *  reader came from. */
export function timeline(visits, reads) {
  const grouped = groupReads(reads);
  return [...visits]
    .sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : (a.id ?? 0) - (b.id ?? 0)))
    .map((v) => {
      const mine = grouped.filter((r) => matches(v, r));
      const best = mine.sort((a, b) => rank(b.dwell) - rank(a.dwell))[0];
      return { ts: v.ts, org: v.org, country: v.country, path: v.path, from: v.from_path ?? v.referrer ?? null, bot: v.bot, kind: v.bot_kind ?? null, dwell: best?.dwell ?? null, scroll: best?.scroll ?? null };
    });
}

/** Only characters a network name or pattern may need; anything else is refused
 *  so that it can be put in a SQL string safely. */
export function safeOrgPattern(p) {
  return typeof p === 'string' && /^[\p{L}\p{N} .,&'()/-]{2,60}$/u.test(p) ? p.replace(/'/g, "''") : null;
}
