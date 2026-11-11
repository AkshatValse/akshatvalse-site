/**
 * Reads: how long a page was actually open, not just requested. A small script
 * (src/scripts/read-beacon.js) sends one beacon when a page is hidden or left;
 * functions/api/read.js validates it with the functions below and stores one
 * row in the table `reads`. What a row holds is described in the header of
 * analytics/visit.js; in short, the same network fields as a visit and two
 * buckets, never raw values:
 *   dwell   how long the page was visible: '<10s', '10-30s', '30s-2m', '2-5m',
 *           '5-15m' or '>15m'
 *   scroll  the deepest point reached, in quarters of the page: 1, 2, 3 or 4
 *
 * The beacon is cumulative: a page that is hidden and shown again sends the
 * total visible time so far each time, so one read can leave several rows; the
 * report (scripts/visitors.mjs) counts one read per hour, page and network.
 */
import { SITE_HOSTS, MAX_PATH, cleanPath } from './visit.js';

/** Upper bound (exclusive, in seconds) and label of each dwell bucket. */
export const DWELL_BUCKETS = [
  [10, '<10s'],
  [30, '10-30s'],
  [120, '30s-2m'],
  [300, '2-5m'],
  [900, '5-15m'],
  [Infinity, '>15m'],
];

/** A beacon body is a few dozen bytes; anything past this is not one. */
export const MAX_BODY = 200;
const MAX_SECONDS = 86400;

export function dwellBucket(seconds) {
  for (const [limit, label] of DWELL_BUCKETS) if (seconds < limit) return label;
  return DWELL_BUCKETS.at(-1)[1];
}

/** 1 to 4: the quarter of the page that the deepest scroll position reached. */
export function scrollQuarter(fraction) {
  return Math.min(4, Math.max(1, Math.ceil(fraction * 4)));
}

/**
 * Parse a beacon body strictly: JSON of exactly {"p": path, "t": seconds,
 * "s": scroll fraction}, nothing else. Returns null for anything different.
 * @param {string} text
 * @returns {{ path: string, seconds: number, scroll: number } | null}
 */
export function parseReadBody(text) {
  if (typeof text !== 'string' || text.length === 0 || text.length > MAX_BODY) return null;
  let o;
  try { o = JSON.parse(text); } catch { return null; }
  if (o === null || typeof o !== 'object' || Array.isArray(o)) return null;
  const keys = Object.keys(o).sort();
  if (keys.length !== 3 || keys[0] !== 'p' || keys[1] !== 's' || keys[2] !== 't') return null;
  const { p, s, t } = o;
  if (typeof p !== 'string' || p.length < 1 || p.length > MAX_PATH || p[0] !== '/') return null;
  if (/[?#\\\u0000-\u001f\u007f]/.test(p)) return null;
  if (typeof t !== 'number' || !Number.isFinite(t) || t < 0 || t > MAX_SECONDS) return null;
  if (typeof s !== 'number' || !Number.isFinite(s) || s < 0 || s > 1) return null;
  return { path: cleanPath(p), seconds: t, scroll: s };
}

/** The beacon must come from a page of this site: an Origin header naming it,
 *  or, when the browser sends none, Sec-Fetch-Site: same-origin. */
export function isSameOrigin({ origin, secFetchSite }) {
  if (origin) {
    try {
      const u = new URL(origin);
      return u.protocol === 'https:' && u.port === '' && SITE_HOSTS.has(u.hostname) && u.origin === origin;
    } catch {
      return false;
    }
  }
  return secFetchSite === 'same-origin';
}

/** A static asset lookup says whether a path is a real page of the site. */
export function isHtmlPage(status, contentType) {
  return status === 200 && /^text\/html\b/i.test(contentType ?? '');
}

export const READ_INSERT_SQL =
  'INSERT INTO reads (ts, path, country, org, asn, device, dwell, scroll) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)';

export function readArgs(r) {
  return [r.ts, r.path, r.country, r.org, r.asn, r.device, r.dwell, r.scroll];
}
