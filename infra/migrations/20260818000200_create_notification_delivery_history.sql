-- migrate:up

CREATE OR REPLACE FUNCTION reject_notification_destination_version_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'notification destination versions are immutable'
    USING ERRCODE = '55000';
END;
$$;

CREATE TABLE notification_delivery_history (
  delivery_id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  monitor_id uuid NOT NULL,
  monitor_name text NOT NULL,
  pool_key text NOT NULL CHECK (pool_key ~ '^56:0x([0-9a-f]{40}|[0-9a-f]{64})$'),
  condition_summary text NOT NULL,
  window_minutes smallint NOT NULL CHECK (window_minutes IN (1, 5, 15, 30, 60)),
  window_end timestamptz NOT NULL,
  destination_id text NOT NULL CHECK (char_length(destination_id) BETWEEN 1 AND 200),
  destination_name text NOT NULL,
  destination_type text NOT NULL CHECK (destination_type IN ('telegram', 'webhook', 'local-sink')),
  status text NOT NULL CHECK (status IN ('pending', 'sending', 'retrying', 'delivered', 'failed')),
  attempt_count smallint NOT NULL CHECK (attempt_count BETWEEN 0 AND 6),
  next_retry_at timestamptz,
  delivered_at timestamptz,
  error_code text CHECK (error_code IS NULL OR error_code ~ '^[A-Z][A-Z0-9_:-]{0,79}$'),
  provider_acknowledgement text CHECK (
    provider_acknowledgement IS NULL
    OR (
      char_length(provider_acknowledgement) BETWEEN 1 AND 120
      AND provider_acknowledgement !~ '[[:cntrl:]]'
    )
  ),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT notification_delivery_history_names_valid CHECK (
    char_length(monitor_name) BETWEEN 1 AND 120
    AND char_length(destination_name) BETWEEN 1 AND 120
    AND char_length(condition_summary) <= 4096
  ),
  CONSTRAINT notification_delivery_history_state_valid CHECK (
    (status = 'retrying' AND next_retry_at IS NOT NULL)
    OR (status <> 'retrying' AND next_retry_at IS NULL)
  ),
  CONSTRAINT notification_delivery_history_delivery_valid CHECK (
    (status = 'delivered' AND delivered_at IS NOT NULL)
    OR (status <> 'delivered' AND delivered_at IS NULL)
  ),
  CHECK (updated_at >= created_at)
);

CREATE INDEX notification_delivery_history_user_created_idx
  ON notification_delivery_history (user_id, created_at DESC, delivery_id DESC);
CREATE INDEX notification_delivery_history_user_monitor_created_idx
  ON notification_delivery_history (user_id, monitor_id, created_at DESC, delivery_id DESC);
CREATE INDEX notification_delivery_history_user_status_created_idx
  ON notification_delivery_history (user_id, status, created_at DESC, delivery_id DESC);

INSERT INTO notification_delivery_history (
  delivery_id, user_id, monitor_id, monitor_name, pool_key, condition_summary,
  window_minutes, window_end, destination_id, destination_name, destination_type,
  status, attempt_count, next_retry_at, delivered_at, error_code,
  provider_acknowledgement, created_at, updated_at
)
SELECT
  outbox.delivery_id,
  outbox.user_id,
  outbox.monitor_id,
  monitor.name,
  monitor.pool_key,
  COALESCE(outbox.payload ->> 'conditionSummary', ''),
  monitor.window_minutes,
  candidate.window_end,
  outbox.destination_id,
  COALESCE(version.name, left(outbox.destination_id, 120)),
  outbox.channel,
  CASE outbox.state
    WHEN 'pending' THEN 'pending'
    WHEN 'leased' THEN 'sending'
    WHEN 'retry-wait' THEN 'retrying'
    WHEN 'delivered' THEN 'delivered'
    ELSE 'failed'
  END,
  outbox.attempt_count,
  outbox.next_attempt_at,
  outbox.delivered_at,
  outbox.last_error_code,
  NULL,
  outbox.created_at,
  outbox.updated_at
FROM notification_outbox AS outbox
JOIN monitors AS monitor
  ON monitor.monitor_id = outbox.monitor_id
 AND monitor.user_id = outbox.user_id
JOIN monitor_candidates AS candidate
  ON candidate.candidate_key = outbox.candidate_key
LEFT JOIN notification_destination_versions AS version
  ON version.destination_id::text = outbox.destination_id
 AND version.user_id = outbox.user_id
 AND version.revision = outbox.destination_revision;

COMMENT ON TABLE notification_delivery_history IS
  'User-owned immutable-context delivery projection retained independently from monitor, destination, candidate, and Outbox lifecycles.';

-- migrate:down

DROP TABLE notification_delivery_history;

CREATE OR REPLACE FUNCTION reject_notification_destination_version_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'notification destination versions are immutable'
    USING ERRCODE = '55000';
END;
$$;
