-- migrate:up

CREATE TABLE monitors (
  monitor_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  revision bigint NOT NULL CHECK (revision BETWEEN 1 AND 9007199254740991),
  name text NOT NULL,
  pool_key text NOT NULL,
  window_minutes smallint NOT NULL CHECK (window_minutes IN (1, 5, 15, 30, 60)),
  status text NOT NULL CHECK (status IN ('disabled', 'enabled')),
  conditions jsonb NOT NULL,
  condition_count smallint NOT NULL CHECK (condition_count BETWEEN 0 AND 16),
  enabled_condition_count smallint NOT NULL CHECK (
    enabled_condition_count BETWEEN 0 AND condition_count
  ),
  exclude_han_token boolean NOT NULL,
  exclude_hook boolean NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  enabled_at timestamptz,
  disabled_at timestamptz,
  CONSTRAINT monitors_owner_key UNIQUE (monitor_id, user_id),
  CONSTRAINT monitors_name_valid CHECK (
    name = btrim(name)
    AND char_length(name) BETWEEN 1 AND 120
    AND name !~ '[[:cntrl:]]'
  ),
  CONSTRAINT monitors_pool_key_valid CHECK (
    pool_key ~ '^56:0x([0-9a-f]{40}|[0-9a-f]{64})$'
  ),
  CONSTRAINT monitors_conditions_valid CHECK (
    jsonb_typeof(conditions) = 'array'
    AND jsonb_array_length(conditions) = condition_count
  ),
  CONSTRAINT monitors_lifecycle_time_valid CHECK (
    updated_at >= created_at
    AND (enabled_at IS NULL OR enabled_at >= created_at)
    AND (disabled_at IS NULL OR disabled_at >= created_at)
    AND (status = 'disabled' OR enabled_condition_count > 0)
  )
);

CREATE INDEX monitors_user_created_idx
  ON monitors (user_id, created_at DESC, monitor_id DESC);
CREATE INDEX monitors_user_status_created_idx
  ON monitors (user_id, status, created_at DESC, monitor_id DESC);

CREATE TABLE monitor_create_idempotency (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  monitor_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, idempotency_key),
  CONSTRAINT monitor_create_idempotency_key_valid CHECK (
    char_length(idempotency_key) BETWEEN 1 AND 128
    AND idempotency_key ~ '^[A-Za-z0-9._:-]+$'
  ),
  CONSTRAINT monitor_create_idempotency_monitor_fk
    FOREIGN KEY (monitor_id, user_id)
    REFERENCES monitors (monitor_id, user_id)
    ON DELETE CASCADE
);

CREATE TABLE monitor_candidates (
  candidate_key text PRIMARY KEY CHECK (candidate_key ~ '^[0-9a-f]{64}$'),
  monitor_id uuid NOT NULL,
  user_id uuid NOT NULL,
  monitor_revision bigint NOT NULL CHECK (monitor_revision BETWEEN 1 AND 9007199254740991),
  pool_key text NOT NULL CHECK (pool_key ~ '^56:0x([0-9a-f]{40}|[0-9a-f]{64})$'),
  window_end timestamptz NOT NULL,
  generated_at timestamptz NOT NULL,
  metric_version text NOT NULL CHECK (char_length(metric_version) BETWEEN 1 AND 80),
  source_generation_id text NOT NULL CHECK (char_length(source_generation_id) BETWEEN 1 AND 200),
  replaces_generation_id text,
  canonical_block_hash text NOT NULL CHECK (canonical_block_hash ~ '^0x[0-9a-f]{64}$'),
  blocklist_hash text NOT NULL CHECK (blocklist_hash ~ '^sha256:[0-9a-f]{64}$'),
  matched_conditions jsonb NOT NULL CHECK (jsonb_typeof(matched_conditions) = 'array'),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT monitor_candidates_identity_key UNIQUE (
    monitor_id, monitor_revision, pool_key, window_end, metric_version
  ),
  CONSTRAINT monitor_candidates_owner_key UNIQUE (candidate_key, user_id, monitor_id),
  CONSTRAINT monitor_candidates_monitor_fk
    FOREIGN KEY (monitor_id, user_id)
    REFERENCES monitors (monitor_id, user_id)
    ON DELETE CASCADE,
  CHECK (window_end <= generated_at),
  CHECK (updated_at >= created_at)
);

CREATE INDEX monitor_candidates_monitor_window_idx
  ON monitor_candidates (monitor_id, window_end DESC, generated_at DESC, source_generation_id DESC);

CREATE TABLE monitor_evaluation_watermarks (
  monitor_id uuid NOT NULL,
  user_id uuid NOT NULL,
  pool_key text NOT NULL CHECK (pool_key ~ '^56:0x([0-9a-f]{40}|[0-9a-f]{64})$'),
  metric_version text NOT NULL CHECK (char_length(metric_version) BETWEEN 1 AND 80),
  window_end timestamptz NOT NULL,
  generated_at timestamptz NOT NULL,
  source_generation_id text NOT NULL CHECK (char_length(source_generation_id) BETWEEN 1 AND 200),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (monitor_id, pool_key, metric_version),
  CONSTRAINT monitor_evaluation_watermarks_monitor_fk
    FOREIGN KEY (monitor_id, user_id)
    REFERENCES monitors (monitor_id, user_id)
    ON DELETE CASCADE,
  CHECK (window_end <= generated_at)
);

CREATE TABLE notification_outbox (
  delivery_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dedupe_key text NOT NULL UNIQUE CHECK (dedupe_key ~ '^[0-9a-f]{64}$'),
  candidate_key text NOT NULL,
  monitor_id uuid NOT NULL,
  user_id uuid NOT NULL,
  destination_id text NOT NULL CHECK (char_length(destination_id) BETWEEN 1 AND 200),
  destination_revision bigint NOT NULL CHECK (
    destination_revision BETWEEN 0 AND 9007199254740991
  ),
  channel text NOT NULL CHECK (channel IN ('telegram', 'webhook', 'local-sink')),
  category text NOT NULL CHECK (category = 'monitor-match'),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  state text NOT NULL CHECK (state IN ('pending', 'leased', 'retry-wait', 'delivered', 'dead')),
  attempt_count smallint NOT NULL CHECK (attempt_count BETWEEN 0 AND 6),
  next_attempt_at timestamptz,
  lease_owner text,
  lease_token uuid,
  lease_expires_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  delivered_at timestamptz,
  last_error_code text CHECK (last_error_code IS NULL OR char_length(last_error_code) <= 80),
  last_error_summary text CHECK (
    last_error_summary IS NULL OR char_length(last_error_summary) <= 240
  ),
  CONSTRAINT notification_outbox_candidate_fk
    FOREIGN KEY (candidate_key, user_id, monitor_id)
    REFERENCES monitor_candidates (candidate_key, user_id, monitor_id)
    ON DELETE CASCADE,
  CONSTRAINT notification_outbox_lease_valid CHECK (
    (
      state = 'leased'
      AND lease_owner IS NOT NULL
      AND lease_token IS NOT NULL
      AND lease_expires_at IS NOT NULL
      AND attempt_count > 0
    )
    OR (
      state <> 'leased'
      AND lease_owner IS NULL
      AND lease_token IS NULL
      AND lease_expires_at IS NULL
    )
  ),
  CONSTRAINT notification_outbox_retry_time_valid CHECK (
    (state = 'retry-wait' AND next_attempt_at IS NOT NULL)
    OR (state <> 'retry-wait' AND next_attempt_at IS NULL)
  ),
  CONSTRAINT notification_outbox_delivery_time_valid CHECK (
    (state = 'delivered' AND delivered_at IS NOT NULL)
    OR (state <> 'delivered' AND delivered_at IS NULL)
  ),
  CHECK (updated_at >= created_at)
);

CREATE INDEX notification_outbox_due_idx
  ON notification_outbox (state, next_attempt_at, lease_expires_at, created_at, delivery_id)
  WHERE state IN ('pending', 'leased', 'retry-wait');
CREATE INDEX notification_outbox_candidate_idx
  ON notification_outbox (candidate_key, state);
CREATE INDEX notification_outbox_user_created_idx
  ON notification_outbox (user_id, created_at DESC, delivery_id DESC);

CREATE TABLE monitor_candidate_suppressions (
  suppression_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  candidate_key text NOT NULL REFERENCES monitor_candidates(candidate_key) ON DELETE CASCADE,
  attempted_source_generation_id text NOT NULL,
  attempted_generated_at timestamptz NOT NULL,
  reason text NOT NULL CHECK (reason = 'terminal-outbox'),
  recorded_at timestamptz NOT NULL,
  UNIQUE (candidate_key, attempted_source_generation_id)
);

COMMENT ON TABLE monitors IS
  'User-owned BSC monitor aggregates with optimistic revision and immutable canonical pool identity.';
COMMENT ON TABLE monitor_candidates IS
  'Deterministic logical monitor matches; generation fields retain canonical replacement evidence.';
COMMENT ON TABLE monitor_evaluation_watermarks IS
  'Persistent lexicographic windowEnd/generatedAt/sourceGenerationId high watermarks.';
COMMENT ON TABLE notification_outbox IS
  'Credential-free persistent delivery intents; no notification key or destination secret is stored.';

-- migrate:down

DROP TABLE monitor_candidate_suppressions;
DROP TABLE notification_outbox;
DROP TABLE monitor_evaluation_watermarks;
DROP TABLE monitor_candidates;
DROP TABLE monitor_create_idempotency;
DROP TABLE monitors;
