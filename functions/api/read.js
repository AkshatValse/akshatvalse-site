/**
 * POST /api/read: the endpoint for the read beacon (src/scripts/read-beacon.js).
 * It stores how long a page was open and how far it was scrolled, in buckets,
 * in the D1 table `reads`; analytics/read.js and analytics/visit.js say exactly
 * what a row holds and what is never stored.
 *
 * Strict by design: it answers 405 to anything but POST, 403 to a request that
 * does not come from a page of this site, 400 to a body that is not exactly
 * the expected few fields or names a path that is not a real page, and 204
 * (nothing stored, nothing said) to a reader who must not be logged: the
 * opt-out cookie, Sec-GPC: 1, DNT: 1, X-No-Log: 1, an automated client, or a
 * missing database binding. It never touches a page, and a database failure
 * is written to the Functions log and otherwise ignored.
 */
import {
  SITE_HOSTS, skipReason, botKind, deviceOf, hourOf, shouldPrune, PRUNE_SQLS, pruneBefore,
} from '../../analytics/visit.js';
import {
  parseReadBody, isSameOrigin, isHtmlPage, dwellBucket, scrollQuarter, READ_INSERT_SQL, readArgs, MAX_BODY,
} from '../../analytics/read.js';

/** Tests replace `rng` to make the one-in-fifty pruning deterministic. */
export const _internals = { rng: Math.random };

const reply = (status, headers = {}) => new Response(null, { status, headers: { 'Cache-Control': 'no-store', ...headers } });

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'POST') return reply(405, { Allow: 'POST' });
  try {
    const url = new URL(request.url);
    const h = request.headers;
    if (!SITE_HOSTS.has(url.hostname)) return reply(204);
    if (!isSameOrigin({ origin: h.get('origin'), secFetchSite: h.get('sec-fetch-site') })) return reply(403);

    if (skipReason({ cookie: h.get('cookie'), secGpc: h.get('sec-gpc'), dnt: h.get('dnt'), xNoLog: h.get('x-no-log') })) return reply(204);
    const db = env?.VISITS;
    if (!db) return reply(204);
    const userAgent = h.get('user-agent');
    if (botKind({ userAgent, acceptLanguage: h.get('accept-language'), secFetchMode: h.get('sec-fetch-mode'), secChUa: h.get('sec-ch-ua') })) return reply(204);

    const declared = Number(h.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_BODY) return reply(400);
    const body = parseReadBody((await request.text()).slice(0, MAX_BODY + 1));
    if (!body) return reply(400);

    // The path must be a real page: ask the static assets. A 404 page, a
    // redirect or a file is not one.
    const asset = await env?.ASSETS?.fetch(new URL(body.path, url.origin));
    if (!asset || !isHtmlPage(asset.status, asset.headers.get('content-type'))) return reply(400);

    const now = new Date();
    const cf = request.cf;
    const row = {
      ts: hourOf(now),
      path: body.path,
      country: typeof cf?.country === 'string' ? cf.country.slice(0, 2) : null,
      org: typeof cf?.asOrganization === 'string' ? cf.asOrganization.slice(0, 120) : null,
      asn: Number.isInteger(cf?.asn) ? cf.asn : null,
      device: deviceOf(userAgent),
      dwell: dwellBucket(body.seconds),
      scroll: scrollQuarter(body.scroll),
    };
    const statements = [db.prepare(READ_INSERT_SQL).bind(...readArgs(row))];
    if (shouldPrune(_internals.rng)) for (const sql of PRUNE_SQLS) statements.push(db.prepare(sql).bind(pruneBefore(now)));
    context.waitUntil?.(db.batch(statements).catch((err) => console.warn('read log failed:', err?.message ?? String(err))));
  } catch (err) {
    console.warn('read log skipped:', err?.message ?? String(err));
  }
  return reply(204);
}
