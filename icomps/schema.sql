-- Red&White Investment Competition: D1 schema
-- Apply with: wrangler d1 execute <DB_NAME> --file=schema.sql

CREATE TABLE IF NOT EXISTS teams (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL UNIQUE COLLATE NOCASE,
  lead_email        TEXT NOT NULL,
  key_hash          TEXT NOT NULL,                 -- SHA-256 of the team passcode
  alpaca_account_id TEXT,
  status            TEXT NOT NULL DEFAULT 'provisioning', -- provisioning | pending_funding | active | failed
  created_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS team_members (
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name    TEXT NOT NULL,
  email   TEXT NOT NULL,
  is_lead INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (team_id, email)
);
-- One team per person
CREATE UNIQUE INDEX IF NOT EXISTS idx_member_email ON team_members (lower(email));

CREATE TABLE IF NOT EXISTS equity_snapshots (
  team_id     TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  ts          TEXT NOT NULL,                       -- ISO 8601 UTC
  equity      REAL NOT NULL,
  last_equity REAL NOT NULL,                       -- prior-close equity from Alpaca
  cash        REAL NOT NULL,
  PRIMARY KEY (team_id, ts)
);

CREATE TABLE IF NOT EXISTS strategy_submissions (
  team_id      TEXT PRIMARY KEY REFERENCES teams(id) ON DELETE CASCADE,
  body         TEXT NOT NULL,
  submitted_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS judge_scores (
  team_id  TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  judge_id TEXT NOT NULL,
  score    INTEGER NOT NULL,
  notes    TEXT,
  PRIMARY KEY (team_id, judge_id)
);
