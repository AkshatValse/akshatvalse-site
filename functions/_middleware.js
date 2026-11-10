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
 * /research/<slug>/ still pass through it and are skipped by file type.
 *
 * Bind VISITS for the Production environment only, so preview deployments
 * never log; the host check below is a second guard. In the Pages project's
 * Settings > Runtime, "Fail open" keeps pages up if the free daily Functions
 * quota runs out.
 */
import {
  shouldLog, isSpeculative, buildVisit, INSERT_SQL, PRUNE_SQL, insertArgs, pruneBefore,
  optOutRequest, isOptedOut, optOutCookie,
} from '../analytics/visit.js';

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
    if (isOptedOut(request.headers.get('cookie'))) return response;

    const db = context.env?.VISITS;
    if (!db) return response;

    const h = request.headers;
    const ok = shouldLog({
      method: request.method,
      hostname: url.hostname,
      pathname: url.pathname,
      status: response.status,
      contentType: response.headers.get('content-type'),
      navigate: h.get('sec-fetch-mode') === 'navigate' || h.get('sec-fetch-dest') === 'document',
    });
    if (!ok) return response;

    const now = new Date();
    const visit = buildVisit({
      url: request.url,
      userAgent: h.get('user-agent'),
      referer: h.get('referer'),
      speculative: isSpeculative(h.get('sec-purpose') ?? h.get('purpose'), h.get('x-moz')),
      cf: request.cf,
    }, now);
    const write = db.batch([
      db.prepare(INSERT_SQL).bind(...insertArgs(visit)),
      db.prepare(PRUNE_SQL).bind(pruneBefore(now)),
    ]).catch((err) => console.warn('visit log failed:', err?.message ?? String(err)));
    context.waitUntil(write);
  } catch (err) {
    console.warn('visit log skipped:', err?.message ?? String(err));
  }
  return response;
}
