-- Additive only: old code keeps working against this schema (its INSERT names
-- its columns, and the new ones are nullable). Apply it BEFORE deploying the
-- code that uses it. ALTER TABLE ... ADD COLUMN cannot be repeated, so run
-- this file once.

-- What kind of automated fetch a bot = 1 row is (assistant, preview, search,
-- ai-crawler, monitor, headless, script); NULL for people and for old rows.
ALTER TABLE visits ADD COLUMN bot_kind TEXT;

-- When the referrer is this site, the path of the page the reader came from
-- (no query string); NULL otherwise and for old rows.
ALTER TABLE visits ADD COLUMN from_path TEXT;

-- Reads: one row per beacon sent when a page is hidden or left. Buckets, not
-- raw values; see analytics/read.js and analytics/visit.js.
CREATE TABLE IF NOT EXISTS reads (
  id      INTEGER PRIMARY KEY,   -- rowid; no AUTOINCREMENT (cheaper writes)
  ts      TEXT    NOT NULL,      -- hour of the beacon, UTC, "YYYY-MM-DDTHH:00Z"
  path    TEXT    NOT NULL,      -- page path, no query string
  country TEXT,                  -- ISO 3166-1 alpha-2
  org     TEXT,                  -- network (AS) organisation name
  asn     INTEGER,               -- network (AS) number
  device  TEXT,                  -- 'mobile' | 'desktop'
  dwell   TEXT    NOT NULL,      -- visible time: '<10s','10-30s','30s-2m','2-5m','5-15m','>15m'
  scroll  INTEGER NOT NULL       -- deepest scroll in quarters of the page: 1..4
);

CREATE INDEX IF NOT EXISTS reads_ts ON reads (ts);
