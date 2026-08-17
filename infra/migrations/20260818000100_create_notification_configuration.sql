-- migrate:up

CREATE TABLE notification_preferences (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  revision bigint NOT NULL CHECK (revision BETWEEN 1 AND 9007199254740991),
  categories jsonb NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT notification_preferences_categories_valid CHECK (
    jsonb_typeof(categories) = 'object'
    AND jsonb_object_length(categories) = 6
    AND categories ?& ARRAY[
      'monitor-match',
      'task-created',
      'position-moved',
      'operation-failed',
      'position-closed',
      'feedback-replied'
    ]
    AND jsonb_typeof(categories -> 'monitor-match') = 'boolean'
    AND jsonb_typeof(categories -> 'task-created') = 'boolean'
    AND jsonb_typeof(categories -> 'position-moved') = 'boolean'
    AND jsonb_typeof(categories -> 'operation-failed') = 'boolean'
    AND jsonb_typeof(categories -> 'position-closed') = 'boolean'
    AND jsonb_typeof(categories -> 'feedback-replied') = 'boolean'
  )
);

CREATE TABLE notification_destinations (
  destination_id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  current_revision bigint NOT NULL CHECK (
    current_revision BETWEEN 1 AND 9007199254740991
  ),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  deleted_at timestamptz,
  CONSTRAINT notification_destinations_owner_key UNIQUE (destination_id, user_id),
  CONSTRAINT notification_destinations_current_key UNIQUE (
    destination_id,
    user_id,
    current_revision
  ),
  CHECK (updated_at >= created_at),
  CHECK (deleted_at IS NULL OR deleted_at >= created_at)
);

CREATE TABLE notification_destination_versions (
  destination_id uuid NOT NULL,
  user_id uuid NOT NULL,
  revision bigint NOT NULL CHECK (revision BETWEEN 1 AND 9007199254740991),
  type text NOT NULL CHECK (type IN ('telegram', 'webhook')),
  name text NOT NULL,
  enabled boolean NOT NULL,
  categories text[] NOT NULL,
  config jsonb NOT NULL,
  secret_ref text,
  tombstone boolean NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (destination_id, revision),
  CONSTRAINT notification_destination_versions_owner_key UNIQUE (
    destination_id,
    user_id,
    revision
  ),
  CONSTRAINT notification_destination_versions_destination_fk
    FOREIGN KEY (destination_id, user_id)
    REFERENCES notification_destinations (destination_id, user_id)
    ON DELETE CASCADE
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT notification_destination_versions_name_valid CHECK (
    name = btrim(name)
    AND char_length(name) BETWEEN 1 AND 120
    AND name !~ '[[:cntrl:]]'
  ),
  CONSTRAINT notification_destination_versions_categories_valid CHECK (
    cardinality(categories) BETWEEN 1 AND 6
    AND categories <@ ARRAY[
      'monitor-match',
      'task-created',
      'position-moved',
      'operation-failed',
      'position-closed',
      'feedback-replied'
    ]::text[]
  ),
  CONSTRAINT notification_destination_versions_config_valid CHECK (
    jsonb_typeof(config) = 'object'
    AND NOT config ?| ARRAY[
      'botToken',
      'bot_token',
      'hmacSecret',
      'hmac_secret',
      'signingSecret',
      'signing_secret',
      'telegramToken',
      'telegram_token'
    ]
  ),
  CONSTRAINT notification_destination_versions_secret_ref_valid CHECK (
    secret_ref IS NULL
    OR (
      char_length(secret_ref) BETWEEN 1 AND 512
      AND secret_ref !~ '[[:cntrl:][:space:]]'
    )
  ),
  CONSTRAINT notification_destination_versions_tombstone_valid CHECK (
    NOT tombstone
    OR (NOT enabled AND config = '{}'::jsonb AND secret_ref IS NULL)
  )
);

ALTER TABLE notification_destinations
  ADD CONSTRAINT notification_destinations_current_version_fk
  FOREIGN KEY (destination_id, user_id, current_revision)
  REFERENCES notification_destination_versions (destination_id, user_id, revision)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE notification_destination_create_idempotency (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  destination_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, idempotency_key),
  CONSTRAINT notification_destination_create_idempotency_key_valid CHECK (
    char_length(idempotency_key) BETWEEN 1 AND 128
    AND idempotency_key ~ '^[A-Za-z0-9._:-]+$'
  ),
  CONSTRAINT notification_destination_create_idempotency_destination_fk
    FOREIGN KEY (destination_id, user_id)
    REFERENCES notification_destinations (destination_id, user_id)
    ON DELETE CASCADE
);

CREATE TABLE monitor_notification_destination_bindings (
  monitor_id uuid NOT NULL,
  user_id uuid NOT NULL,
  destination_id uuid NOT NULL,
  monitor_revision bigint NOT NULL CHECK (
    monitor_revision BETWEEN 1 AND 9007199254740991
  ),
  bound_at timestamptz NOT NULL,
  PRIMARY KEY (monitor_id, destination_id),
  CONSTRAINT monitor_notification_destination_bindings_monitor_fk
    FOREIGN KEY (monitor_id, user_id)
    REFERENCES monitors (monitor_id, user_id)
    ON DELETE CASCADE,
  CONSTRAINT monitor_notification_destination_bindings_destination_fk
    FOREIGN KEY (destination_id, user_id)
    REFERENCES notification_destinations (destination_id, user_id)
    ON DELETE CASCADE
);

CREATE INDEX notification_destinations_user_current_idx
  ON notification_destinations (user_id, deleted_at, created_at DESC, destination_id DESC);
CREATE INDEX notification_destination_versions_owner_revision_idx
  ON notification_destination_versions (user_id, destination_id, revision DESC);
CREATE INDEX monitor_notification_destination_bindings_destination_idx
  ON monitor_notification_destination_bindings (user_id, destination_id, monitor_id);

CREATE FUNCTION reject_notification_destination_version_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'notification destination versions are immutable'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER notification_destination_versions_immutable
BEFORE UPDATE OR DELETE ON notification_destination_versions
FOR EACH ROW
EXECUTE FUNCTION reject_notification_destination_version_mutation();

COMMENT ON TABLE notification_preferences IS
  'Current-user category opt-ins; absence means every category is disabled at revision zero.';
COMMENT ON TABLE notification_destination_versions IS
  'Append-only redacted destination revisions. Credentials are represented only by opaque secret_ref values.';
COMMENT ON TABLE monitor_notification_destination_bindings IS
  'Current per-monitor destination bindings stamped with the owning monitor revision.';

-- migrate:down

DROP TABLE monitor_notification_destination_bindings;
DROP TABLE notification_destination_create_idempotency;
ALTER TABLE notification_destinations
  DROP CONSTRAINT notification_destinations_current_version_fk;
DROP TRIGGER notification_destination_versions_immutable ON notification_destination_versions;
DROP FUNCTION reject_notification_destination_version_mutation();
DROP TABLE notification_destination_versions;
DROP TABLE notification_destinations;
DROP TABLE notification_preferences;
