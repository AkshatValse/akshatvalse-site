// npm run test:visits — the rules behind scripts/visitors.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  kindOf, isEdu, isRelayOrCloud, groupReads, summarise, dwellByPage, newNetworks, networkKey, parseWatchlist, isWatched,
  timeline, safeOrgPattern,
} from './report.js';

const R = (o) => ({ ts: '2026-11-10T15:00Z', path: '/research', org: 'Iowa State University', asn: 2698, device: 'desktop', dwell: '30s-2m', scroll: 2, ...o });
const V = (o) => ({ id: 1, ts: '2026-11-10T15:00Z', path: '/research', org: 'Iowa State University', asn: 2698, device: 'desktop', bot: 0, referrer: null, from_path: null, bot_kind: null, ...o });

test('network kinds, word-bounded', () => {
  assert.equal(kindOf('Iowa State University'), 'university');
  assert.equal(kindOf('Stanford University'), 'university');
  assert.equal(kindOf('Rutgers'), '');
  assert.equal(kindOf('Comcast Cable Communications'), 'home/mobile');
  assert.equal(kindOf('Apple Inc.'), 'relay/scan');
  assert.equal(kindOf('Amazon.com, Inc.'), 'cloud');
  assert.equal(kindOf(null), '');
  assert.equal(isEdu('MIT Institute of Technology'), true);
  assert.equal(isEdu('Comcast'), false);
  assert.equal(isRelayOrCloud('Cloudflare, Inc.'), true);
  assert.equal(isRelayOrCloud('Hetzner Online GmbH'), true);
  assert.equal(isRelayOrCloud('Iowa State University'), false);
});

test('beacons are cumulative: one read per hour, page and network, with the largest dwell and scroll', () => {
  const g = groupReads([R({ dwell: '<10s', scroll: 1 }), R({ dwell: '2-5m', scroll: 3 }), R({ dwell: '10-30s', scroll: 4 }),
    R({ path: '/about' }), R({ ts: '2026-11-10T16:00Z' }), R({ org: 'Other', asn: 1 })]);
  assert.equal(g.length, 4);
  const one = g.find((r) => r.path === '/research' && r.ts === '2026-11-10T15:00Z' && r.asn === 2698);
  assert.equal(one.dwell, '2-5m');
  assert.equal(one.scroll, 4);
});

test('a read needs a beacon with at least ten seconds; relay and cloud networks are counted apart', () => {
  const visits = [V({}), V({ id: 2, path: '/about' }), V({ id: 3, path: '/cv', org: 'Amazon.com, Inc.', asn: 16509 }), V({ id: 4, path: '/x' })];
  const reads = [R({}), R({ path: '/about', dwell: '<10s' }), R({ path: '/cv', org: 'Amazon.com, Inc.', asn: 16509 })];
  const s = summarise(visits, reads);
  assert.equal(s.reads, 1, 'only the ISU read: >= 10 s, not a cloud network');
  assert.equal(s.relayReads, 1, 'the cloud network read is its own line');
  assert.equal(s.loads, 4);
  assert.equal(s.noBeacon, 1, '/x has no beacon; /about has one under 10 s, which is still a beacon');
});

test('a beacon in the next hour still belongs to the visit; two hours later it does not', () => {
  assert.equal(summarise([V({})], [R({ ts: '2026-11-10T16:00Z' })]).noBeacon, 0);
  assert.equal(summarise([V({})], [R({ ts: '2026-11-10T17:00Z' })]).noBeacon, 1);
  assert.equal(summarise([V({})], [R({ device: 'mobile' })]).noBeacon, 1);
});

test('prefetches: how many were later opened', () => {
  const s = summarise([V({ bot: 2 }), V({ id: 2, bot: 2, path: '/about' })], [R({})]);
  assert.equal(s.prefetched, 2);
  assert.equal(s.opened, 1);
  assert.equal(s.loads, 0, 'a prefetch is not a person');
});

test('read-time buckets per page', () => {
  const rows = dwellByPage([R({}), R({ ts: '2026-11-10T16:00Z', dwell: '>15m' }), R({ path: '/about', dwell: '<10s' })]);
  const research = rows.find((r) => r.path === '/research');
  assert.equal(research['30s-2m'], 1);
  assert.equal(research['>15m'], 1);
  assert.equal(rows.find((r) => r.path === '/about')['<10s'], 1);
});

test('networks seen for the first time', () => {
  const nets = [{ org: 'A', asn: 1 }, { org: 'B', asn: 2 }, { org: 'C', asn: null }];
  assert.deepEqual(newNetworks(nets, ['AS1', 'org:C']).map((n) => n.org), ['B']);
  assert.deepEqual(newNetworks(nets, []).map((n) => n.org), ['A', 'B', 'C']);
  assert.deepEqual(newNetworks(nets, undefined).length, 3);
  assert.equal(networkKey({ asn: 5, org: 'x' }), 'AS5');
});

test('the watch list: comments, case, substrings', () => {
  const w = parseWatchlist('# where I am applying\nStanford\n\n  mit  # trailing\r\ncarnegie mellon\n');
  assert.deepEqual(w, ['stanford', 'mit', 'carnegie mellon']);
  assert.equal(isWatched('Stanford University', w), true);
  assert.equal(isWatched('CARNEGIE MELLON UNIVERSITY', w), true);
  assert.equal(isWatched('Iowa State University', w), false);
  assert.equal(isWatched(null, w), false);
  assert.equal(isWatched('Stanford', []), false);
});

test('one network\'s timeline is in order, with read time and where the reader came from', () => {
  const visits = [V({ id: 2, ts: '2026-11-10T16:00Z', path: '/about', from_path: '/research' }), V({ id: 1, referrer: 'google' })];
  const t = timeline(visits, [R({ dwell: '2-5m', scroll: 3 })]);
  assert.deepEqual(t.map((r) => r.path), ['/research', '/about']);
  assert.equal(t[0].dwell, '2-5m');
  assert.equal(t[0].from, 'google');
  assert.equal(t[1].from, '/research');
  assert.equal(t[1].dwell, null);
});

test('--org patterns are refused unless they are safe to put in SQL', () => {
  assert.equal(safeOrgPattern('iowa state'), 'iowa state');
  assert.equal(safeOrgPattern("o'reilly"), "o''reilly");
  for (const bad of ["'; DROP TABLE visits; --", 'a', 'x'.repeat(61), '50%', 'a_b', 'x;y', '', null, undefined]) assert.equal(safeOrgPattern(bad), null, String(bad));
});
