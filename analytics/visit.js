/**
 * Visit logging for akshatvalse.com: which pages are read, and from which
 * networks. Pure functions only, so they can be tested without Cloudflare;
 * functions/_middleware.js does the I/O.
 *
 * What one row holds, and nothing else:
 *   ts        the hour of the view, UTC ("2026-11-10T15:00Z")
 *   path      the page's path, without any query string or fragment
 *   country   two-letter country code, as Cloudflare reports it
 *   org       the name of the network the visitor connects from (the
 *             organisation that owns its autonomous system): a university,
 *             a company, or a home or mobile provider
 *   asn       that network's number
 *   referrer  a label for where the visit came from: a known site
 *             ("google", "scholar.google", "linkedin", ...), a university
 *             domain ("stanford.edu"), "internal", "other", or null (direct)
 *   device    'mobile' (phones, Android tablets) or 'desktop' (all else)
 *   bot       0 a person, 1 automated (crawler, link preview, script),
 *             2 a browser prefetch (the page may or may not have been opened)
 *
 * Never stored: IP addresses, user-agent strings, full referrer URLs or
 * arbitrary referrer host names, query strings, cookies' contents, or any
 * identifier. Rows hold no identifier, but on a very small network a few rows
 * in the same hour may well be one person; treat the data that way.
 * Rows older than RETENTION_DAYS are deleted on every write.
 */

export const SITE_HOSTS = new Set(['akshatvalse.com', 'www.akshatvalse.com']);
export const MAX_PATH = 200;
export const RETENTION_DAYS = 400;

/** User agents that are not a person reading the page. Link-preview fetchers
 *  (LinkedIn, Slack, iMessage...) and AI assistants fetching a page for a user
 *  count here too: they mean someone shared or asked about a link. */
const BOT_UA = new RegExp([
  String.raw`bot\b`, String.raw`bot/`, 'crawl', 'spider', 'slurp', 'archiver', 'bingpreview', 'facebookexternalhit',
  'embedly', 'iframely', 'cardyb', 'preview', 'whatsapp', 'skypeuripreview', 'mastodon', 'headless', 'phantomjs',
  'lighthouse', 'pagespeed', 'google-inspectiontool', 'googleother', 'pingdom', 'uptime', 'monitor', 'scanner',
  'dataprovider', 'externalfetcher', String.raw`-user\b`, 'read-aloud', 'ms-office', 'python', 'scrapy', String.raw`curl/`,
  String.raw`wget/`, 'httpie', 'httpclient', 'http-client', String.raw`http\.rb`, 'go-http', String.raw`java/`, 'okhttp', 'axios',
  'node-fetch', 'undici', 'libwww', 'feedfetcher', 'validator',
].join('|'), 'i');

const MOBILE_UA = /mobi|android|iphone|ipod/i;

/** Paths of files, not pages. _routes.json keeps most of these away from the
 *  function; this is the backstop. */
const ASSET_PATH = /\.(?:css|js|mjs|map|json|xml|txt|pdf|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|mp4|webm)$/i;

/** Sites worth naming as referrers. Checked in order; the first match wins.
 *  Anything not listed here (and not a university) is stored as "other". */
const SOURCES = [
  [/^scholar\.google\./, 'scholar.google'],
  [/^mail\.google\.com$|^com\.google\.android\.gm$/, 'gmail'],
  [/^gemini\.google\.com$/, 'gemini'],
  [/(^|\.)google\.[a-z.]+$|^com\.google\.android\.googlequicksearchbox$/, 'google'],
  [/(^|\.)bing\.com$/, 'bing'],
  [/(^|\.)duckduckgo\.com$/, 'duckduckgo'],
  [/^search\.brave\.com$/, 'brave search'],
  [/(^|\.)ecosia\.org$/, 'ecosia'],
  [/(^|\.)kagi\.com$/, 'kagi'],
  [/(^|\.)yahoo\.com$/, 'yahoo'],
  [/(^|\.)baidu\.com$/, 'baidu'],
  [/(^|\.)yandex\.[a-z.]+$/, 'yandex'],
  [/(^|\.)linkedin\.com$|^lnkd\.in$|^com\.linkedin\.android$/, 'linkedin'],
  [/(^|\.)github\.com$/, 'github'],
  [/^t\.co$|(^|\.)x\.com$|(^|\.)twitter\.com$/, 'x'],
  [/(^|\.)reddit\.com$/, 'reddit'],
  [/^news\.ycombinator\.com$/, 'hacker news'],
  [/(^|\.)bsky\.app$/, 'bluesky'],
  [/(^|\.)(facebook|instagram)\.com$|(^|\.)threads\.net$/, 'meta'],
  [/(^|\.)youtube\.com$/, 'youtube'],
  [/(^|\.)outlook\.(live|office|office365)\.com$|(^|\.)outlook\.cloud\.microsoft$|(^|\.)office\.com$|^com\.microsoft\.office\.outlook$/, 'outlook'],
  [/(^|\.)arxiv\.org$/, 'arxiv'],
  [/(^|\.)semanticscholar\.org$/, 'semantic scholar'],
  [/(^|\.)researchgate\.net$/, 'researchgate'],
  [/(^|\.)orcid\.org$/, 'orcid'],
  [/(^|\.)openreview\.net$/, 'openreview'],
  [/(^|\.)chatgpt\.com$|(^|\.)openai\.com$/, 'chatgpt'],
  [/(^|\.)perplexity\.ai$/, 'perplexity'],
  [/(^|\.)claude\.ai$/, 'claude'],
];

/** Whether a request/response pair is something to log at all. */
export function shouldLog({ method, hostname, pathname, status, contentType, navigate }) {
  if (method !== 'GET') return false;
  if (!SITE_HOSTS.has(hostname)) return false;
  if (ASSET_PATH.test(pathname)) return false;
  if (cleanPath(pathname) === '/404') return false;
  // A fresh page, or a cached page the browser revalidated while navigating
  // (304s carry no content type).
  if (status === 200) return /^text\/html\b/i.test(contentType ?? '');
  if (status === 304) return Boolean(navigate);
  return false;
}

/** Whether request headers mark a speculative load (prefetch or prerender). */
export function isSpeculative(purpose, xMoz) {
  return /prefetch|prerender/i.test(purpose ?? '') || /prefetch/i.test(xMoz ?? '');
}

export function isBot(userAgent) {
  return !userAgent || BOT_UA.test(userAgent);
}

export function deviceOf(userAgent) {
  return MOBILE_UA.test(userAgent ?? '') ? 'mobile' : 'desktop';
}

/** A label for the referring site, never its full host name unless it is a
 *  university domain. */
export function referrerLabel(referer) {
  if (!referer) return null;
  let host;
  try {
    host = new URL(referer).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
  if (!host) return null;
  if (SITE_HOSTS.has(host) || SITE_HOSTS.has('www.' + host)) return 'internal';
  for (const [re, label] of SOURCES) if (re.test(host)) return label;
  // Universities: keep the institution's domain, drop any department or
  // personal subdomain. "cs.stanford.edu" -> "stanford.edu",
  // "www.cl.cam.ac.uk" -> "cam.ac.uk", "unimelb.edu.au" -> "unimelb.edu.au".
  const labels = host.split('.');
  if (/^[a-z0-9-]+$/.test(labels.join('')) && labels.length >= 2) {
    if (labels.at(-1) === 'edu') return labels.slice(-2).join('.');
    if (labels.length >= 3 && /^(ac|edu)$/.test(labels.at(-2)) && /^[a-z]{2}$/.test(labels.at(-1))) return labels.slice(-3).join('.');
  }
  return 'other';
}

/** Normalise a path: decoded, lower case, single slashes, no trailing ".html"
 *  (Pages serves /research for research.html), no trailing slash except the
 *  root, capped in length. */
export function cleanPath(pathname) {
  let p = pathname || '/';
  try { p = decodeURI(p); } catch { /* keep as sent */ }
  p = p.toLowerCase().replace(/\/{2,}/g, '/').replace(/\.html$/, '').replace(/\/index$/, '/');
  if (p.length > 1) p = p.replace(/\/+$/, '');
  return p.slice(0, MAX_PATH) || '/';
}

/** The hour of a time, UTC, in the stored format. */
export function hourOf(date) {
  return date.toISOString().slice(0, 13) + ':00Z';
}

/**
 * Build the row for one logged request.
 * @param {{ url: string, userAgent?: string|null, referer?: string|null, speculative?: boolean,
 *           cf?: { country?: string, asOrganization?: string, asn?: number } }} req
 * @param {Date} now
 */
export function buildVisit({ url, userAgent, referer, speculative, cf }, now) {
  const { pathname } = new URL(url);
  const bot = isBot(userAgent) ? 1 : speculative ? 2 : 0;
  return {
    ts: hourOf(now),
    path: cleanPath(pathname),
    country: typeof cf?.country === 'string' ? cf.country.slice(0, 2) : null,
    org: typeof cf?.asOrganization === 'string' ? cf.asOrganization.slice(0, 120) : null,
    asn: Number.isInteger(cf?.asn) ? cf.asn : null,
    referrer: referrerLabel(referer),
    device: deviceOf(userAgent),
    bot,
  };
}

export const INSERT_SQL =
  'INSERT INTO visits (ts, path, country, org, asn, referrer, device, bot) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)';

export const PRUNE_SQL = 'DELETE FROM visits WHERE ts < ?1';

/** Rows with ts before this are past retention. */
export function pruneBefore(now) {
  return hourOf(new Date(now.getTime() - RETENTION_DAYS * 86400e3));
}

export function insertArgs(v) {
  return [v.ts, v.path, v.country, v.org, v.asn, v.referrer, v.device, v.bot];
}

/** Opting out: the owner opens /?nolog=1 once per browser so his own visits
 *  are not counted (/?nolog=0 undoes it). Returns '1', '0' or null. */
export function optOutRequest(searchParams) {
  const v = searchParams.get('nolog');
  return v === '1' || v === '0' ? v : null;
}

export function isOptedOut(cookieHeader) {
  return /(?:^|;\s*)nolog=1(?:;|$)/.test(cookieHeader ?? '');
}

export function optOutCookie(value) {
  return value === '1'
    ? 'nolog=1; Max-Age=31536000; Path=/; Secure; HttpOnly; SameSite=Lax'
    : 'nolog=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax';
}
