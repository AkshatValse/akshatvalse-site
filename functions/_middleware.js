/**
 * Logs page views on akshatvalse.com to the D1 database bound as VISITS (see
 * analytics/visit.js for exactly what is stored and what never is).
 *
 * The page is served first and logged afterwards with waitUntil, so logging
 * never delays a page, and any failure, including a missing binding, leaves
 * the page untouched (failures are written to the Functions log). If this
 * function itself throws, passThroughOnException serves the static file.
 *
 * public/_routes.json keeps the big static folders (scripts, styles, fonts,
 * template assets, images) away from this function. Figures under
 * /research/<slug>/ still pass through it and are skipped by file type. The CV
 * PDF passes through on purpose: a download is logged as a view of its path.
 *
 * Not logged: the owner's opt-out cookie, Sec-GPC: 1, DNT: 1, X-No-Log: 1.
 * Old rows are pruned on about one write in fifty.
 *
 * Bind VISITS for the Production environment only, so preview deployments
 * never log; the host check below is a second guard. In the Pages project's
 * Settings > Runtime, "Fail open" keeps pages up if the free daily Functions
 * quota runs out.
 */
import {
  shouldLog, isSpeculative, buildVisit, INSERT_SQL, PRUNE_SQLS, insertArgs, pruneBefore, shouldPrune,
  optOutRequest, skipReason, optOutCookie,
} from '../analytics/visit.js';

/** Tests replace `rng` to make the one-in-fifty pruning deterministic. */
export const _internals = { rng: Math.random };

export async function onRequest(context) {
  context.passThroughOnException?.();
  const response = await context.next();
  try {
    const { request } = context;
    const url = new URL(request.url);

    const optOut = optOutRequest(url.searchParams);
    if (optOut) {
      const res = new Response(response.body, response);
      res.headers.append('Set-Cookie', optOutCookie(optOut));
      res.headers.set('Cache-Control', 'no-store');
      return res;
    }
    const h = request.headers;
    // The owner's cookie, a Global Privacy Control or Do Not Track signal, or
    // X-No-Log: 1: not logged, whatever else is true of the request.
    if (skipReason({ cookie: h.get('cookie'), secGpc: h.get('sec-gpc'), dnt: h.get('dnt'), xNoLog: h.get('x-no-log') })) return response;

    const db = context.env?.VISITS;
    if (!db) return response;

    const ok = shouldLog({
      method: request.method,
      hostname: url.hostname,
      pathname: url.pathname,
      status: response.status,
      contentType: response.headers.get('content-type'),
      navigate: h.get('sec-fetch-mode') === 'navigate' || h.get('sec-fetch-dest') === 'document',
      range: h.get('range'),
    });
    if (!ok) return response;

    const now = new Date();
    const visit = buildVisit({
      url: request.url,
      userAgent: h.get('user-agent'),
      referer: h.get('referer'),
      acceptLanguage: h.get('accept-language'),
      secFetchMode: h.get('sec-fetch-mode'),
      secChUa: h.get('sec-ch-ua'),
      speculative: isSpeculative(h.get('sec-purpose') ?? h.get('purpose'), h.get('x-moz')),
      cf: request.cf,
    }, now);
    const statements = [db.prepare(INSERT_SQL).bind(...insertArgs(visit))];
    if (shouldPrune(_internals.rng)) for (const sql of PRUNE_SQLS) statements.push(db.prepare(sql).bind(pruneBefore(now)));
    const write = db.batch(statements).catch((err) => console.warn('visit log failed:', err?.message ?? String(err)));
    context.waitUntil(write);
  } catch (err) {
    console.warn('visit log skipped:', err?.message ?? String(err));
  }
  return response;
}
