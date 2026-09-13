BEGIN;

CREATE SCHEMA IF NOT EXISTS varoriya_security;

CREATE TABLE IF NOT EXISTS varoriya_security.resource_owners (
  resource_type text NOT NULL CHECK (resource_type IN ('job', 'file')),
  resource_id text NOT NULL CHECK (resource_id ~ '^[A-Za-z0-9._:-]{1,256}$'),
  subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 256),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (resource_type, resource_id)
);

CREATE INDEX IF NOT EXISTS resource_owners_subject_idx
  ON varoriya_security.resource_owners (subject, resource_type, created_at);

CREATE TABLE IF NOT EXISTS varoriya_security.cost_windows (
  subject text NOT NULL,
  window_start_ms bigint NOT NULL,
  reset_at_ms bigint NOT NULL,
  limit_units bigint NOT NULL CHECK (limit_units > 0),
  consumed_units bigint NOT NULL DEFAULT 0 CHECK (consumed_units >= 0),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (subject, window_start_ms),
  CHECK (consumed_units <= limit_units),
  CHECK (reset_at_ms > window_start_ms)
);

CREATE TABLE IF NOT EXISTS varoriya_security.cost_reservations (
  subject text NOT NULL,
  window_start_ms bigint NOT NULL,
  reservation_key text NOT NULL,
  request_id text NOT NULL,
  cost_units bigint NOT NULL CHECK (cost_units > 0),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (subject, window_start_ms, reservation_key),
  FOREIGN KEY (subject, window_start_ms)
    REFERENCES varoriya_security.cost_windows (subject, window_start_ms)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS varoriya_security.quote_records (
  token_hash text PRIMARY KEY,
  quote_id text NOT NULL UNIQUE,
  subject text NOT NULL,
  model text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('image', 'video', 'audio')),
  parameters_payload jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  cost_amount text NOT NULL,
  cost_currency text NOT NULL CHECK (cost_currency ~ '^[A-Z]{3}$'),
  cost_units bigint NOT NULL CHECK (cost_units >= 0),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp()
);

CREATE INDEX IF NOT EXISTS quote_records_expiry_idx
  ON varoriya_security.quote_records (expires_at);

CREATE TABLE IF NOT EXISTS varoriya_security.idempotency_records (
  subject text NOT NULL,
  idempotency_key text NOT NULL,
  state text NOT NULL CHECK (state IN ('reserved', 'completed')),
  lease_id text,
  request_id text NOT NULL,
  request_fingerprint text NOT NULL
    CHECK (request_fingerprint ~ '^[A-Za-z0-9_-]{43}$'),
  lease_expires_at timestamptz,
  completed_retention_ms bigint NOT NULL CHECK (completed_retention_ms > 0),
  retain_until timestamptz NOT NULL,
  job_id text,
  job_payload jsonb,
  quoted_cost_amount text,
  quoted_cost_currency text,
  final_cost_amount text,
  final_cost_currency text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (subject, idempotency_key),
  CHECK (
    (state = 'reserved' AND lease_id IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR
    (state = 'completed' AND lease_id IS NULL AND job_id IS NOT NULL AND job_payload IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idempotency_retention_idx
  ON varoriya_security.idempotency_records (retain_until);

COMMIT;
