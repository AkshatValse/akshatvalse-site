-- Page views for akshatvalse.com. One row per logged request; see
-- analytics/visit.js for what each column holds and what is never stored.
CREATE TABLE IF NOT EXISTS visits (
  id       INTEGER PRIMARY KEY,        -- rowid; no AUTOINCREMENT (cheaper writes)
  ts       TEXT    NOT NULL,           -- hour of the view, UTC, "YYYY-MM-DDTHH:00Z"
  path     TEXT    NOT NULL,           -- page path, no query string
  country  TEXT,                       -- ISO 3166-1 alpha-2
  org      TEXT,                       -- network (AS) organisation name
  asn      INTEGER,                    -- network (AS) number
  referrer TEXT,                       -- a label: known site, university domain, 'internal', 'other'; NULL = direct
  device   TEXT,                       -- 'mobile' | 'desktop'
  bot      INTEGER NOT NULL DEFAULT 0  -- 0 person, 1 automated, 2 prefetch
);

CREATE INDEX IF NOT EXISTS visits_ts ON visits (ts);
