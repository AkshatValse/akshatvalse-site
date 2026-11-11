// npm run test:visits — src/scripts/read-beacon.js, run against stubbed browser globals.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const SCRIPT = new URL('../src/scripts/read-beacon.js', import.meta.url).href;
let n = 0;

/** Run the script in a fake page; returns controls and the beacons it sent. */
async function page({ webdriver = false, gpc, dnt, hostname = 'akshatvalse.com', visibility = 'visible', sendBeacon = true } = {}) {
  const sent = [];
  const listeners = { document: {}, window: {} };
  let now = 0;
  const g = globalThis;
  const set = (k, v) => Object.defineProperty(g, k, { value: v, configurable: true, writable: true });
  set('navigator', { webdriver, globalPrivacyControl: gpc, doNotTrack: dnt, ...(sendBeacon ? { sendBeacon: (url, body) => { sent.push({ url, body: JSON.parse(body) }); return true; } } : {}) });
  set('location', { hostname, pathname: '/research' });
  set('performance', { now: () => now });
  const doc = { visibilityState: visibility, documentElement: { scrollHeight: 4000 }, addEventListener: (t, f) => { listeners.document[t] = f; } };
  set('document', doc);
  const win = { scrollY: 0, innerHeight: 1000 };
  set('window', win);
  set('scrollY', 0);
  set('innerHeight', 1000);
  set('addEventListener', (t, f) => { listeners.window[t] = f; });
  await import(`${SCRIPT}?run=${n++}`);
  return {
    sent,
    tick: (ms) => { now += ms; },
    scrollTo: (y) => { win.scrollY = y; g.scrollY = y; listeners.window.scroll?.(); },
    hide: () => { doc.visibilityState = 'hidden'; listeners.document.visibilitychange?.(); },
    show: () => { doc.visibilityState = 'visible'; listeners.document.visibilitychange?.(); },
    leave: () => listeners.window.pagehide?.(),
  };
}

test('sends the path, the seconds visible and the deepest scroll when the page is hidden', async () => {
  const p = await page();
  p.tick(12400);
  p.scrollTo(1500); // viewport bottom at 2500 of 4000
  p.scrollTo(200);  // scrolling back up does not reduce the deepest point
  p.hide();
  assert.equal(p.sent.length, 1);
  assert.equal(p.sent[0].url, '/api/read');
  assert.deepEqual(p.sent[0].body, { p: '/research', t: 12, s: 0.63 });
});

test('time spent hidden does not count, and the total is cumulative when the page returns', async () => {
  const p = await page();
  p.tick(5000); p.hide();
  p.tick(600000); p.show();
  p.tick(20000); p.hide();
  assert.deepEqual(p.sent.map((s) => s.body.t), [5, 25]);
});

test('hide then pagehide sends once for one stretch of visibility', async () => {
  const p = await page();
  p.tick(3000); p.hide(); p.leave();
  assert.equal(p.sent.length, 1);
  const q = await page();
  q.tick(3000); q.leave();
  assert.equal(q.sent.length, 1, 'a page that is left without being hidden first still reports');
});

test('a page opened in the background counts only the time it was visible', async () => {
  const p = await page({ visibility: 'hidden' });
  p.tick(30000); p.show(); p.tick(7000); p.hide();
  assert.equal(p.sent[0].body.t, 7);
});

test('T9: nothing is sent from an automated browser', async () => {
  const p = await page({ webdriver: true });
  p.tick(20000); p.hide(); p.leave();
  assert.equal(p.sent.length, 0);
});

test('T2: nothing is sent when Global Privacy Control or Do Not Track is on', async () => {
  for (const opts of [{ gpc: true }, { dnt: '1' }]) {
    const p = await page(opts);
    p.tick(20000); p.hide();
    assert.equal(p.sent.length, 0, JSON.stringify(opts));
  }
  const off = await page({ gpc: false, dnt: '0' });
  off.tick(20000); off.hide();
  assert.equal(off.sent.length, 1);
});

test('nothing is sent from another host, or where sendBeacon is missing', async () => {
  for (const opts of [{ hostname: 'localhost' }, { hostname: 'akshatvalse-site.pages.dev' }, { sendBeacon: false }]) {
    const p = await page(opts);
    p.tick(20000); p.hide();
    assert.equal(p.sent.length, 0, JSON.stringify(opts));
  }
});

test('at most twenty beacons per page load', async () => {
  const p = await page();
  for (let i = 0; i < 30; i++) { p.tick(1000); p.hide(); p.show(); }
  assert.equal(p.sent.length, 20);
});
