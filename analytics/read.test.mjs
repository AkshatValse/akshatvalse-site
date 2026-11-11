// npm run test:visits — the read beacon: parsing, buckets, and the endpoint.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dwellBucket, scrollQuarter, parseReadBody, isSameOrigin, isHtmlPage, READ_INSERT_SQL, readArgs, DWELL_BUCKETS,
} from './read.js';
import { onRequest, _internals } from '../functions/api/read.js';

const SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const body = (o = {}) => JSON.stringify({ p: '/research', t: 42, s: 0.8, ...o });

test('dwell buckets', () => {
  const cases = [[0, '<10s'], [9.9, '<10s'], [10, '10-30s'], [29, '10-30s'], [30, '30s-2m'], [119, '30s-2m'], [120, '2-5m'],
    [299, '2-5m'], [300, '5-15m'], [899, '5-15m'], [900, '>15m'], [86400, '>15m']];
  for (const [sec, want] of cases) assert.equal(dwellBucket(sec), want, String(sec));
  assert.equal(DWELL_BUCKETS.length, 6);
});

test('scroll in quarters', () => {
  const cases = [[0, 1], [0.01, 1], [0.25, 1], [0.26, 2], [0.5, 2], [0.51, 3], [0.75, 3], [0.76, 4], [1, 4]];
  for (const [f, q] of cases) assert.equal(scrollQuarter(f), q, String(f));
});

test('the body is exactly {p, t, s}, strictly', () => {
  assert.deepEqual(parseReadBody(body()), { path: '/research', seconds: 42, scroll: 0.8 });
  assert.deepEqual(parseReadBody(body({ p: '/Research/' })).path, '/research');
  for (const bad of [
    '', 'not json', 'null', '[]', '"x"', '42',
    body({ extra: 1 }), JSON.stringify({ p: '/', t: 1 }), JSON.stringify({ p: '/', t: 1, s: 1, u: 'ua' }),
    body({ p: 'research' }), body({ p: '' }), body({ p: '//evil.example/x' + 'a'.repeat(300) }), body({ p: '/a?b=c' }), body({ p: '/a#b' }),
    body({ p: '/a\nb' }), body({ p: 5 }), body({ t: -1 }), body({ t: 90000 }), body({ t: '42' }), body({ t: null }),
    body({ s: 1.5 }), body({ s: -0.1 }), body({ s: '0.5' }), '{"p":"/","t":1,"s":1,"s":2,"x":1}',
    ' '.repeat(10) + body() + ' '.repeat(200),
  ]) assert.equal(parseReadBody(bad), null, bad.slice(0, 50));
  assert.equal(parseReadBody(undefined), null);
});

test('same origin only', () => {
  assert.equal(isSameOrigin({ origin: 'https://akshatvalse.com' }), true);
  assert.equal(isSameOrigin({ origin: 'https://www.akshatvalse.com' }), true);
  assert.equal(isSameOrigin({ origin: null, secFetchSite: 'same-origin' }), true);
  for (const bad of [
    { origin: 'https://evil.example' }, { origin: 'https://akshatvalse.com.evil.example' }, { origin: 'http://akshatvalse.com' },
    { origin: 'https://akshatvalse.com:8443' }, { origin: 'null' }, { origin: 'https://akshatvalse.com/' },
    { origin: null, secFetchSite: 'cross-site' }, { origin: null, secFetchSite: 'same-site' }, { origin: null }, {},
  ]) assert.equal(isSameOrigin(bad), false, JSON.stringify(bad));
});

test('a real page is a 200 HTML asset', () => {
  assert.equal(isHtmlPage(200, 'text/html; charset=utf-8'), true);
  for (const [st, ct] of [[404, 'text/html'], [308, 'text/html'], [200, 'image/svg+xml'], [200, null], [200, 'application/json']]) {
    assert.equal(isHtmlPage(st, ct), false);
  }
});

// ---- the endpoint, against a fake Cloudflare context -----------------------

function fakeDb(mode = 'ok') {
  const calls = [];
  return {
    calls,
    prepare(sql) { if (mode === 'throw') throw new Error('prepare failed'); return { bind: (...args) => ({ sql, args }) }; },
    batch(stmts) { calls.push(stmts); return mode === 'reject' ? Promise.reject(new Error('D1 down')) : Promise.resolve([]); },
  };
}
const assets = (pages = ['/research', '/']) => ({
  fetch: async (url) => {
    const p = new URL(url).pathname;
    return pages.includes(p) ? new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } }) : new Response('nf', { status: 404, headers: { 'content-type': 'text/html' } });
  },
});
function ctx({ method = 'POST', url = 'https://akshatvalse.com/api/read', headers = {}, text = body(), db = fakeDb(), env, cf } = {}) {
  const waited = [];
  const request = new Request(url, {
    method,
    headers: { 'user-agent': SAFARI, 'accept-language': 'en-US', origin: 'https://akshatvalse.com', 'content-type': 'text/plain;charset=UTF-8', ...headers },
    ...(method === 'POST' ? { body: text } : {}),
  });
  if (cf !== undefined) Object.defineProperty(request, 'cf', { value: cf });
  return { request, env: env ?? { VISITS: db, ASSETS: assets() }, waitUntil: (p) => waited.push(p), waited, db };
}
const stored = async (c) => { await Promise.all(c.waited); return c.db.calls; };

test('endpoint: a valid beacon stores one bucketed row and nothing else', async () => {
  _internals.rng = () => 0.5;
  const c = ctx({ cf: { country: 'US', asOrganization: 'Iowa State University', asn: 2698, city: 'Ames' }, text: body({ t: 95, s: 0.6 }) });
  const res = await onRequest(c);
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const calls = await stored(c);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].length, 1);
  const { sql, args } = calls[0][0];
  assert.equal(sql, READ_INSERT_SQL);
  assert.equal(args[1], '/research');
  assert.deepEqual(args.slice(2), ['US', 'Iowa State University', 2698, 'desktop', '30s-2m', 3]);
  assert.match(args[0], /^\d{4}-\d{2}-\d{2}T\d{2}:00Z$/);
  const text = JSON.stringify(args);
  for (const leak of ['Ames', 'Safari', 'Macintosh', '95', '0.6']) assert.ok(!text.includes(leak), leak);
  assert.equal(readArgs({ ts: 1, path: 2, country: 3, org: 4, asn: 5, device: 6, dwell: 7, scroll: 8 }).length, 8);
});

test('endpoint: pruning rides along on about one write in fifty', async () => {
  _internals.rng = () => 0;
  const c = ctx();
  await onRequest(c);
  const calls = await stored(c);
  assert.deepEqual(calls[0].slice(1).map((s) => s.sql.match(/FROM (\w+)/)[1]), ['visits', 'reads']);
});

test('endpoint: only POST from this site', async () => {
  _internals.rng = () => 0.5;
  for (const method of ['GET', 'PUT', 'DELETE']) {
    const c = ctx({ method });
    const res = await onRequest(c);
    assert.equal(res.status, 405, method);
    assert.equal(res.headers.get('allow'), 'POST');
    assert.equal((await stored(c)).length, 0);
  }
  for (const headers of [{ origin: 'https://evil.example' }, { origin: 'https://akshatvalse.com.evil.example' }]) {
    const c = ctx({ headers });
    assert.equal((await onRequest(c)).status, 403);
    assert.equal((await stored(c)).length, 0);
  }
  const noOrigin = ctx({ headers: { origin: '' } });
  noOrigin.request.headers.delete('origin');
  assert.equal((await onRequest(noOrigin)).status, 403);
  const sameSite = ctx({ headers: { origin: '', 'sec-fetch-site': 'same-origin' } });
  sameSite.request.headers.delete('origin');
  assert.equal((await onRequest(sameSite)).status, 204);
  assert.equal((await stored(sameSite)).length, 1);
  assert.equal((await onRequest(ctx({ url: 'https://akshatvalse-site.pages.dev/api/read' }))).status, 204, 'other hosts: quietly nothing');
});

test('endpoint: bad bodies are refused, and so are paths that are not real pages', async () => {
  for (const text of ['', 'x', body({ extra: 1 }), body({ t: -5 }), body({ s: 7 }), body({ p: '/a?b' }), 'x'.repeat(5000)]) {
    const c = ctx({ text });
    assert.equal((await onRequest(c)).status, 400, text.slice(0, 30));
    assert.equal((await stored(c)).length, 0);
  }
  for (const p of ['/nope', '/research.svg', '/404', '/api/read', '/%2e%2e/etc']) {
    const c = ctx({ text: body({ p }) });
    assert.equal((await onRequest(c)).status, 400, p);
    assert.equal((await stored(c)).length, 0, p);
  }
  const noAssets = ctx({ env: { VISITS: fakeDb() } });
  assert.equal((await onRequest(noAssets)).status, 400);
});

test('T2/T9: the beacon honours the cookie, GPC, DNT, X-No-Log, and automated clients', async () => {
  for (const headers of [{ cookie: 'nolog=1' }, { 'sec-gpc': '1' }, { dnt: '1' }, { 'x-no-log': '1' },
    { 'user-agent': 'curl/8.7.1' }, { 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' }]) {
    const c = ctx({ headers });
    assert.equal((await onRequest(c)).status, 204, JSON.stringify(headers));
    assert.equal((await stored(c)).length, 0, JSON.stringify(headers));
  }
  const noLang = ctx({ headers: { 'accept-language': '' } });
  noLang.request.headers.delete('accept-language');
  assert.equal((await onRequest(noLang)).status, 204);
  assert.equal((await stored(noLang)).length, 0, 'no Accept-Language: automated');
  const chrome = ctx({ headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36' } });
  assert.equal((await onRequest(chrome)).status, 204);
  assert.equal((await stored(chrome)).length, 0, 'headless-looking Chrome');
});

test('endpoint: no binding, or a failing database, never produces an error', async () => {
  const warn = console.warn; const warned = [];
  console.warn = (...a) => warned.push(a.join(' '));
  try {
    assert.equal((await onRequest(ctx({ env: { ASSETS: assets() } }))).status, 204);
    for (const mode of ['reject', 'throw']) {
      const c = ctx({ db: fakeDb(mode) });
      c.env = { VISITS: c.db, ASSETS: assets() };
      assert.equal((await onRequest(c)).status, 204, mode);
      await Promise.all(c.waited);
    }
  } finally { console.warn = warn; }
  assert.equal(warned.length, 2);
});
