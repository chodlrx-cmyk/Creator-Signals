-- Creator Signals admin dashboard — D1 schema (v1)
-- Privacy by design: no e-mail addresses, IP addresses, user agents, cookies or other identifiers are stored.

-- Website events (cookieless): one row per page view / CTA click / free download click.
CREATE TABLE IF NOT EXISTS events (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  ts        INTEGER NOT NULL,            -- unix seconds (UTC)
  day       TEXT    NOT NULL,            -- YYYY-MM-DD in Europe/Amsterdam
  kind      TEXT    NOT NULL CHECK (kind IN ('view','cta','download')),
  path      TEXT    NOT NULL,            -- page path, no query string
  product   TEXT,                        -- product slug for cta/download (see products.slug)
  source    TEXT    NOT NULL,            -- utm_source, or classified referrer: tiktok/google/instagram/youtube/direct/internal/other
  medium    TEXT,                        -- utm_medium (if any)
  campaign  TEXT,                        -- utm_campaign (if any)
  country   TEXT,                        -- two-letter country from Cloudflare (coarse)
  device    TEXT                         -- mobile / desktop (coarse)
);
CREATE INDEX IF NOT EXISTS idx_events_day  ON events(day);
CREATE INDEX IF NOT EXISTS idx_events_kind ON events(kind, day);

-- Products: maps Payhip product keys to the site's product slugs.
CREATE TABLE IF NOT EXISTS products (
  slug         TEXT PRIMARY KEY,         -- starter-kit / launchpad / accelerator
  name         TEXT NOT NULL,
  payhip_key   TEXT UNIQUE,              -- e.g. juEVT (NULL until the product exists in Payhip)
  kind         TEXT NOT NULL CHECK (kind IN ('free','paid')),
  sort         INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO products (slug, name, payhip_key, kind, sort) VALUES
  ('starter-kit', 'Free Starter Kit',            'dmuVE', 'free', 1),
  ('launchpad',   '30-Day Creator Launchpad',    'juEVT', 'paid', 2),
  ('accelerator', '90-Day Growth Accelerator',   NULL,    'paid', 3);

-- Confirmed Payhip transactions (from the signed "paid" webhook). Amounts in minor units (cents).
CREATE TABLE IF NOT EXISTS transactions (
  id            TEXT PRIMARY KEY,        -- Payhip transaction id (idempotency key)
  ts            INTEGER NOT NULL,        -- Payhip "date" (unix seconds)
  day           TEXT    NOT NULL,        -- Europe/Amsterdam
  currency      TEXT    NOT NULL,
  price         INTEGER NOT NULL,        -- amount charged, minor units, incl. VAT where applied
  payhip_fee    INTEGER,
  stripe_fee    INTEGER,
  vat_applied   INTEGER NOT NULL DEFAULT 0,
  payment_type  TEXT,
  product_keys  TEXT    NOT NULL,        -- comma-separated Payhip product keys
  items_json    TEXT    NOT NULL,        -- items without personal data
  used_coupon   INTEGER NOT NULL DEFAULT 0,
  is_gift       INTEGER NOT NULL DEFAULT 0,
  is_test       INTEGER NOT NULL DEFAULT 0, -- set by the owner in Settings (or 100 % coupon on a paid product)
  received_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tx_day ON transactions(day);

-- Refunds (from the signed "refunded" webhook). One row per refund event, processed once.
CREATE TABLE IF NOT EXISTS refunds (
  transaction_id  TEXT    NOT NULL,
  ts              INTEGER NOT NULL,      -- date_refunded
  day             TEXT    NOT NULL,
  amount          INTEGER NOT NULL,      -- amount_refunded, minor units (cumulative per Payhip event)
  currency        TEXT    NOT NULL,
  received_at     INTEGER NOT NULL,
  PRIMARY KEY (transaction_id, ts)
);

-- Every webhook delivery, for the sync / health view.
CREATE TABLE IF NOT EXISTS webhook_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  received_at  INTEGER NOT NULL,
  type         TEXT,
  txn_id       TEXT,
  status       TEXT NOT NULL,           -- ok / duplicate / bad_signature / bad_payload / not_configured / error
  detail       TEXT
);
CREATE INDEX IF NOT EXISTS idx_wh_time ON webhook_log(received_at);
