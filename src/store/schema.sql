-- Applied automatically at gateway start when DATABASE_URL is set.
CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  monthly_budget_usd NUMERIC(12, 6) NOT NULL,
  rpm_limit INTEGER NOT NULL,
  allowed_models TEXT[] NOT NULL,
  default_model TEXT NOT NULL,
  pii_mode TEXT NOT NULL,
  pii_block_types TEXT[] NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS virtual_keys (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id),
  key_hash TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

-- Ledger and audit log. Holds counts and decisions, never prompt or reply text.
CREATE TABLE IF NOT EXISTS requests (
  id TEXT PRIMARY KEY,
  ts TIMESTAMPTZ NOT NULL,
  team_id TEXT NOT NULL,
  key_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  requested_model TEXT NOT NULL,
  routed_model TEXT,
  route_rule TEXT NOT NULL,
  task TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cost_usd NUMERIC(14, 6) NOT NULL,
  baseline_model TEXT NOT NULL,
  baseline_cost_usd NUMERIC(14, 6) NOT NULL,
  saved_usd NUMERIC(14, 6) NOT NULL,
  cache TEXT NOT NULL,
  redactions JSONB NOT NULL,
  policy JSONB NOT NULL,
  status TEXT NOT NULL,
  http_status INTEGER NOT NULL,
  attempts JSONB NOT NULL,
  fallback_used BOOLEAN NOT NULL,
  latency_ms INTEGER NOT NULL,
  redacted_prompt TEXT
);
CREATE INDEX IF NOT EXISTS requests_team_ts ON requests (team_id, ts DESC);
CREATE INDEX IF NOT EXISTS requests_ts ON requests (ts DESC);
