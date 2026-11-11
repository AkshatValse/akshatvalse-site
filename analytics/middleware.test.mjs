// npm run test:visits — the Pages middleware against a fake Cloudflare context.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequest, _internals } from '../functions/_middleware.js';

const SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const html = () => new Response('<!doctype html><title>x</title>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'x-frame-options': 'DENY' } });

/** A fake D1 binding that records statements. `mode`: 'ok' | 'reject' | 'throw' | 'slow'. */
function fakeDb(mode = 'ok') {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      if (mode === 'throw') throw new Error('prepare failed');
      return { bind: (...args) => ({ sql, args }) };
    },
    batch(stmts) {
      calls.push(stmts);
      if (mode === 'reject') return Promise.reject(new Error('D1 down'));
      if (mode === 'slow') return new Promise((r) => setTimeout(r, 2000));
      return Promise.resolve([]);
    },
  };
}

function ctx({ url = 'https://akshatvalse.com/research', method = 'GET', headers = {}, response = html(), db = fakeDb(), cf } = {}) {
  const waited = [];
  const request = new Request(url, { method, headers: { 'user-agent': SAFARI, 'accept-language': 'en-US,en;q=0.9', 'sec-fetch-mode': 'navigate', ...headers } });
  if (cf !== undefined) Object.defineProperty(request, 'cf', { value: cf });
  return {
    request,
    env: db === null ? {} : { VISITS: db },
    next: async () => response,
    waitUntil: (p) => waited.push(p),
    passThroughOnException: () => {},
    waited, db, response,
  };
}

test('logs a page view after serving it, unchanged', async () => {
  const c = ctx({ cf: { country: 'US', asOrganization: 'Iowa State University', asn: 2698 }, headers: { referer: 'https://scholar.google.com/x' } });
  const res = await onRequest(c);
  assert.equal(res, c.response, 'same response object');
  assert.equal(c.waited.length, 1);
  await Promise.all(c.waited);
  assert.equal(c.db.calls[0].length, 1, 'no pruning on this write');
  const [insert] = c.db.calls[0];
  assert.match(insert.sql, /^INSERT INTO visits/);
  assert.equal(insert.args[1], '/research');
  assert.equal(insert.args[3], 'Iowa State University');
  assert.equal(insert.args[5], 'scholar.google');
  assert.equal(insert.args[7], 0);
  assert.equal(insert.args[8], null, 'no bot kind for a person');
});

test('T8: old rows are pruned from both tables on the writes the dice pick', async () => {
  const real = _internals.rng;
  try {
    _internals.rng = () => 0;
    const c = ctx();
    await onRequest(c); await Promise.all(c.waited);
    const [insert, ...prunes] = c.db.calls[0];
    assert.match(insert.sql, /^INSERT INTO visits/);
    assert.deepEqual(prunes.map((p) => p.sql.match(/FROM (\w+)/)[1]), ['visits', 'reads']);
    assert.ok(prunes.every((p) => /^\d{4}-\d{2}-\d{2}T\d{2}:00Z$/.test(p.args[0])));
    _internals.rng = () => 0.5;
    const d = ctx();
    await onRequest(d); await Promise.all(d.waited);
    assert.equal(d.db.calls[0].length, 1);
  } finally { _internals.rng = real; }
});

test('does not wait for the database before returning the page', async () => {
  const c = ctx({ db: fakeDb('slow') });
  const t0 = Date.now();
  const res = await onRequest(c);
  assert.ok(Date.now() - t0 < 200, 'returned before the slow write finished');
  assert.equal(res, c.response);
});

test('database failures never reach the page', async () => {
  const warn = console.warn; const warned = [];
  console.warn = (...a) => warned.push(a.join(' '));
  try {
    for (const mode of ['reject', 'throw']) {
      const c = ctx({ db: fakeDb(mode) });
      const res = await onRequest(c);
      assert.equal(res, c.response, mode);
      await Promise.all(c.waited);
    }
  } finally { console.warn = warn; }
  assert.equal(warned.length, 2, 'both failures were logged');
});

test('no binding: serves the page and does nothing', async () => {
  const c = ctx({ db: null });
  const res = await onRequest(c);
  assert.equal(res, c.response);
  assert.equal(c.waited.length, 0);
});

test('not logged: HEAD, other hosts, files, errors', async () => {
  for (const opts of [
    { method: 'HEAD' },
    { url: 'https://akshatvalse-site.pages.dev/research' },
    { url: 'https://abc123.akshatvalse-site.pages.dev/research' },
    { url: 'https://akshatvalse.com/research/langevin/cover-art.svg', response: new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } }) },
    { response: new Response('nope', { status: 404, headers: { 'content-type': 'text/html' } }) },
  ]) {
    const c = ctx(opts);
    const res = await onRequest(c);
    assert.equal(res, c.response);
    assert.equal(c.db.calls.length, 0, JSON.stringify(opts.url ?? opts.method ?? opts.response?.status));
  }
});

test('prefetches are kept as bot = 2; crawlers as bot = 1', async () => {
  const p = ctx({ headers: { 'sec-purpose': 'prefetch' } });
  await onRequest(p); await Promise.all(p.waited);
  assert.equal(p.db.calls[0][0].args[7], 2);
  const b = ctx({ headers: { 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' } });
  await onRequest(b); await Promise.all(b.waited);
  assert.equal(b.db.calls[0][0].args[7], 1);
  assert.equal(b.db.calls[0][0].args[8], 'search');
});

test('owner opt-out sets a cookie, and an opted-out browser is not logged', async () => {
  const set = ctx({ url: 'https://akshatvalse.com/?nolog=1' });
  const res = await onRequest(set);
  assert.match(res.headers.get('set-cookie'), /^nolog=1;/);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('x-frame-options'), 'DENY', 'original headers kept');
  assert.equal(await res.text(), '<!doctype html><title>x</title>', 'body kept');
  assert.equal(set.db.calls.length, 0);

  const out = ctx({ headers: { cookie: 'theme=x; nolog=1' } });
  assert.equal(await onRequest(out), out.response);
  assert.equal(out.db.calls.length, 0);

  const clear = ctx({ url: 'https://akshatvalse.com/?nolog=0', headers: { cookie: 'nolog=1' } });
  assert.match((await onRequest(clear)).headers.get('set-cookie'), /^nolog=;.*Max-Age=0/);
});

test('T9: ?nolog=1 returns before anything touches the database, whatever the client is', async () => {
  for (const headers of [{}, { 'sec-purpose': 'prefetch' }, { 'user-agent': 'curl/8.7.1' }, { 'sec-gpc': '1' }]) {
    const c = ctx({ url: 'https://akshatvalse.com/research?nolog=1', headers, db: { prepare() { throw new Error('touched the database'); }, batch() { throw new Error('touched the database'); } } });
    const res = await onRequest(c);
    assert.match(res.headers.get('set-cookie'), /^nolog=1;/);
    assert.equal(c.waited.length, 0);
  }
});

test('T2/T9: Sec-GPC: 1, DNT: 1 and X-No-Log: 1 are not logged; other values are', async () => {
  for (const headers of [{ 'sec-gpc': '1' }, { dnt: '1' }, { 'x-no-log': '1' }]) {
    const c = ctx({ headers });
    assert.equal(await onRequest(c), c.response);
    assert.equal(c.waited.length, 0, JSON.stringify(headers));
    assert.equal(c.db.calls.length, 0);
  }
  for (const headers of [{ 'sec-gpc': '0' }, { dnt: '0' }, { 'x-no-log': '0' }]) {
    const c = ctx({ headers });
    await onRequest(c); await Promise.all(c.waited);
    assert.equal(c.db.calls.length, 1, JSON.stringify(headers));
  }
});

test('T3: a full CV fetch is one row, a ranged fetch from the middle none, one from byte 0 one', async () => {
  const pdf = () => new Response('%PDF', { status: 200, headers: { 'content-type': 'application/pdf' } });
  const url = 'https://akshatvalse.com/akshat-valse-cv-2026-11.pdf';
  const full = ctx({ url, response: pdf(), headers: { 'sec-fetch-mode': 'navigate' } });
  await onRequest(full); await Promise.all(full.waited);
  assert.equal(full.db.calls.length, 1);
  assert.equal(full.db.calls[0][0].args[1], '/akshat-valse-cv-2026-11.pdf');

  const mid = ctx({ url, response: new Response('x', { status: 206, headers: { 'content-type': 'application/pdf' } }), headers: { range: 'bytes=65536-131071' } });
  await onRequest(mid); await Promise.all(mid.waited);
  assert.equal(mid.db.calls.length, 0);

  const head = ctx({ url, response: new Response('x', { status: 206, headers: { 'content-type': 'application/pdf' } }), headers: { range: 'bytes=0-65535' } });
  await onRequest(head); await Promise.all(head.waited);
  assert.equal(head.db.calls.length, 1);
});

test('T5/T9: kinds and the headless rule reach the stored row', async () => {
  const kind = async (headers) => {
    const c = ctx({ headers });
    await onRequest(c); await Promise.all(c.waited);
    return [c.db.calls[0][0].args[7], c.db.calls[0][0].args[8]];
  };
  assert.deepEqual(await kind({ 'user-agent': 'curl/8.7.1' }), [1, 'script']);
  const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
  const c = ctx({ headers: { 'user-agent': CHROME, 'sec-fetch-mode': '' } });
  c.request.headers.delete('sec-fetch-mode');
  await onRequest(c); await Promise.all(c.waited);
  assert.deepEqual([c.db.calls[0][0].args[7], c.db.calls[0][0].args[8]], [1, 'headless']);
  assert.deepEqual(await kind({ 'user-agent': CHROME, 'sec-ch-ua': '"Chromium";v="141"' }), [0, null]);
});

test('T6: an internal referrer stores its path', async () => {
  const c = ctx({ headers: { referer: 'https://akshatvalse.com/about?x=1' } });
  await onRequest(c); await Promise.all(c.waited);
  const a = c.db.calls[0][0].args;
  assert.equal(a[5], 'internal');
  assert.equal(a[9], '/about');
});
