-- migrate:up
CREATE FUNCTION task_status_stats_counts_hash(running_count bigint, paused_count bigint, stopped_count bigint)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT 'sha256:' || encode(
    digest(
      'task-status-stats/v1:' || running_count::text || ':' || paused_count::text || ':' || stopped_count::text,
      'sha256'
    ),
    'hex'
  )
$$;

CREATE TABLE task_status_stats_projection_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  ready boolean NOT NULL DEFAULT false,
  backfill_completed_at timestamptz,
  updated_at timestamptz NOT NULL,
  CHECK (
    (ready = true AND backfill_completed_at IS NOT NULL)
    OR (ready = false AND backfill_completed_at IS NULL)
  )
);

INSERT INTO task_status_stats_projection_state (
  singleton, ready, backfill_completed_at, updated_at
) VALUES (true, false, NULL, '1970-01-01T00:00:00.000Z');

CREATE TABLE task_status_stats_user_snapshots (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  running bigint NOT NULL CHECK (running BETWEEN 0 AND 9007199254740991),
  paused bigint NOT NULL CHECK (paused BETWEEN 0 AND 9007199254740991),
  stopped bigint NOT NULL CHECK (stopped BETWEEN 0 AND 9007199254740991),
  source_revision bigint NOT NULL CHECK (source_revision BETWEEN 0 AND 9007199254740991),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^sha256:[0-9a-f]{64}$'),
  observed_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK (running + paused + stopped <= 9007199254740991)
);

CREATE TABLE task_status_stats_stream_heads (
  scope_key text PRIMARY KEY,
  scope text NOT NULL CHECK (scope IN ('global', 'user')),
  user_id uuid UNIQUE,
  sequence bigint NOT NULL CHECK (sequence BETWEEN 0 AND 9007199254740991),
  running bigint NOT NULL CHECK (running BETWEEN 0 AND 9007199254740991),
  paused bigint NOT NULL CHECK (paused BETWEEN 0 AND 9007199254740991),
  stopped bigint NOT NULL CHECK (stopped BETWEEN 0 AND 9007199254740991),
  content_hash text NOT NULL CHECK (content_hash ~ '^sha256:[0-9a-f]{64}$'),
  observed_at timestamptz NOT NULL,
  CHECK (running + paused + stopped <= 9007199254740991),
  CHECK (
    (scope = 'global' AND scope_key = 'global' AND user_id IS NULL)
    OR (scope = 'user' AND scope_key = 'user:' || user_id::text AND user_id IS NOT NULL)
  )
);

INSERT INTO task_status_stats_stream_heads (
  scope_key, scope, user_id, sequence, running, paused, stopped, content_hash, observed_at
) VALUES (
  'global', 'global', NULL, 0, 0, 0, task_status_stats_counts_hash(0, 0, 0),
  '1970-01-01T00:00:00.000Z'
);

CREATE TABLE task_status_stats_conflicts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_revision bigint NOT NULL CHECK (source_revision BETWEEN 0 AND 9007199254740991),
  existing_payload_hash text NOT NULL CHECK (existing_payload_hash ~ '^sha256:[0-9a-f]{64}$'),
  attempted_payload_hash text NOT NULL CHECK (attempted_payload_hash ~ '^sha256:[0-9a-f]{64}$'),
  attempted_observed_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL
);

CREATE INDEX task_status_stats_conflicts_user_recorded_idx
  ON task_status_stats_conflicts (user_id, recorded_at DESC, id DESC);

CREATE TABLE task_status_stats_query_audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  target_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  target_telegram_user_id bigint NOT NULL CHECK (target_telegram_user_id > 0),
  transport text NOT NULL CHECK (transport IN ('http', 'sse')),
  outcome text NOT NULL CHECK (outcome IN ('allowed', 'not_found')),
  request_id text NOT NULL CHECK (request_id <> ''),
  created_at timestamptz NOT NULL
);

CREATE INDEX task_status_stats_query_audit_actor_created_idx
  ON task_status_stats_query_audit_events (actor_user_id, created_at DESC, id DESC);

CREATE FUNCTION task_status_stats_after_user_snapshot_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  next_running bigint;
  next_paused bigint;
  next_stopped bigint;
  next_hash text;
BEGIN
  UPDATE task_status_stats_stream_heads
     SET sequence = sequence + 1,
         running = 0,
         paused = 0,
         stopped = 0,
         content_hash = task_status_stats_counts_hash(0, 0, 0),
         observed_at = transaction_timestamp()
   WHERE scope_key = 'user:' || OLD.user_id::text
     AND content_hash <> task_status_stats_counts_hash(0, 0, 0);

  PERFORM 1
    FROM task_status_stats_stream_heads
   WHERE scope_key = 'global'
   FOR UPDATE;

  SELECT
    COALESCE(sum(running), 0),
    COALESCE(sum(paused), 0),
    COALESCE(sum(stopped), 0)
  INTO next_running, next_paused, next_stopped
  FROM task_status_stats_user_snapshots;

  IF next_running + next_paused + next_stopped > 9007199254740991 THEN
    RAISE EXCEPTION 'task status global count exceeds safe integer range';
  END IF;

  next_hash := task_status_stats_counts_hash(next_running, next_paused, next_stopped);
  UPDATE task_status_stats_stream_heads
     SET sequence = sequence + 1,
         running = next_running,
         paused = next_paused,
         stopped = next_stopped,
         content_hash = next_hash,
         observed_at = transaction_timestamp()
   WHERE scope_key = 'global'
     AND content_hash <> next_hash;
  RETURN OLD;
END
$$;

CREATE TRIGGER task_status_stats_user_snapshot_delete_trigger
AFTER DELETE ON task_status_stats_user_snapshots
FOR EACH ROW
EXECUTE FUNCTION task_status_stats_after_user_snapshot_delete();

COMMENT ON TABLE task_status_stats_projection_state IS
  'Readiness gate: absent user rows mean zero only after the authoritative task backfill completes.';
COMMENT ON TABLE task_status_stats_user_snapshots IS
  'Latest authoritative absolute running/paused/stopped counts; task-state mapping is owned by the future task domain.';
COMMENT ON TABLE task_status_stats_stream_heads IS
  'Persistent global and per-user task-count stream heads; sequence and full content commit with each changed snapshot.';
COMMENT ON TABLE task_status_stats_query_audit_events IS
  'Credential-free administrator Telegram user filter summaries.';

-- migrate:down
DROP TRIGGER task_status_stats_user_snapshot_delete_trigger ON task_status_stats_user_snapshots;
DROP FUNCTION task_status_stats_after_user_snapshot_delete();
DROP TABLE task_status_stats_query_audit_events;
DROP TABLE task_status_stats_conflicts;
DROP TABLE task_status_stats_stream_heads;
DROP TABLE task_status_stats_user_snapshots;
DROP TABLE task_status_stats_projection_state;
DROP FUNCTION task_status_stats_counts_hash(bigint, bigint, bigint);
