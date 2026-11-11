// npm run test:visits — the three descriptions of what is stored must agree
// with the schema and with each other: the header of analytics/visit.js, the
// README section "Visitor analytics", and the privacy note at /privacy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { RETENTION_DAYS } from './visit.js';

const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const header = read('analytics/visit.js').match(/\/\*\*[\s\S]*?\*\//)[0].replace(/^\s*\* ?/gm, '').replace(/\s+/g, ' ');
const readme = read('README.md').split('## Visitor analytics')[1].split('\n## ')[0].replace(/\s+/g, ' ');
const privacy = read('src/pages/privacy.astro').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');

/** Column names of every table created or altered by the migrations. */
function columns() {
  const cols = { visits: new Set(), reads: new Set() };
  for (const f of readdirSync(new URL('migrations/', root)).sort()) {
    const sql = read(`migrations/${f}`).replace(/--.*$/gm, '');
    for (const m of sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+) \(([\s\S]*?)\);/g)) {
      for (const line of m[2].split(/,\s*\n/)) cols[m[1]].add(line.trim().split(/\s+/)[0]);
    }
    for (const m of sql.matchAll(/ALTER TABLE (\w+) ADD COLUMN (\w+)/g)) cols[m[1]].add(m[2]);
  }
  return cols;
}

test('the header of visit.js names every stored column', () => {
  const c = columns();
  assert.ok(c.visits.size >= 10 && c.reads.size >= 8, 'parsed the migrations');
  for (const col of [...c.visits, ...c.reads].filter((x) => x !== 'id')) assert.ok(header.includes(col), `visit.js header should describe column ${col}`);
});

test('the README section names every stored column too, or its concept', () => {
  for (const word of ['bot_kind', 'from_path', 'reads', 'Sec-GPC', 'X-No-Log', 'nolog', String(RETENTION_DAYS), 'privacy']) {
    assert.ok(readme.includes(word), `README "Visitor analytics" should mention ${word}`);
  }
});

test('the privacy note says what a row holds, what is never stored, the opt-outs and the retention', () => {
  for (const phrase of [
    'hour', 'path', 'country', 'network', 'where the reader came from', 'phone or a desktop', 'automated', 'link preview',
    'how long the page was visible', 'quarters', 'CV', 'IP addresses', 'cookies', 'user-agent', 'query strings',
    'Global Privacy Control', 'Do Not Track', `${RETENTION_DAYS} days`, 'analytics/visit.js',
  ]) assert.ok(privacy.includes(phrase), `privacy note should say: ${phrase}`);
});

test('all three agree on retention and on the opt-out signals', () => {
  for (const [name, text] of [['header', header], ['README', readme], ['privacy note', privacy]]) {
    assert.ok(text.includes(String(RETENTION_DAYS)), `${name}: retention`);
    assert.ok(/Sec-GPC|Global Privacy Control/.test(text), `${name}: Global Privacy Control`);
    assert.ok(/DNT|Do Not Track/.test(text), `${name}: Do Not Track`);
  }
});

test('the descriptions say that no identifier is stored', () => {
  assert.match(privacy, /never stored/i);
  assert.match(header, /Never stored:[\s\S]*IP addresses[\s\S]*any identifier/);
  assert.match(readme, /No IP addresses[\s\S]*identifier/);
});
