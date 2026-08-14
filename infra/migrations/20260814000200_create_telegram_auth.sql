-- migrate:up
CREATE TABLE telegram_identities (
  telegram_user_id bigint PRIMARY KEY CHECK (telegram_user_id > 0),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL
);

CREATE TABLE telegram_init_data_replays (
  digest bytea PRIMARY KEY CHECK (octet_length(digest) = 32),
  consumed_at timestamptz NOT NULL
);

CREATE TABLE telegram_bot_login_intents (
  id uuid PRIMARY KEY,
  token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  status text NOT NULL CHECK (status IN ('pending', 'confirmed', 'consumed', 'cancelled', 'expired')),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  confirmed_at timestamptz,
  consumed_at timestamptz,
  cancelled_at timestamptz,
  CHECK (expires_at > created_at),
  CHECK (
    (status = 'pending'
      AND user_id IS NULL
      AND confirmed_at IS NULL
      AND consumed_at IS NULL
      AND cancelled_at IS NULL)
    OR (status = 'confirmed'
      AND user_id IS NOT NULL
      AND confirmed_at IS NOT NULL
      AND consumed_at IS NULL
      AND cancelled_at IS NULL)
    OR (status = 'consumed'
      AND user_id IS NOT NULL
      AND confirmed_at IS NOT NULL
      AND consumed_at IS NOT NULL
      AND cancelled_at IS NULL)
    OR (status = 'cancelled'
      AND consumed_at IS NULL
      AND cancelled_at IS NOT NULL)
    OR (status = 'expired'
      AND consumed_at IS NULL
      AND cancelled_at IS NULL)
  )
);

CREATE INDEX telegram_bot_login_intents_open_expiry_idx
  ON telegram_bot_login_intents (expires_at)
  WHERE status IN ('pending', 'confirmed');
CREATE INDEX telegram_bot_login_intents_user_created_idx
  ON telegram_bot_login_intents (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

ALTER TABLE access_audit_events
  DROP CONSTRAINT access_audit_events_action_check;
ALTER TABLE access_audit_events
  ADD CONSTRAINT access_audit_events_action_check CHECK (
    action IN (
      'session.access',
      'session.logout',
      'telegram.mini_app.login',
      'telegram.bot.intent.create',
      'telegram.bot.intent.confirm',
      'telegram.bot.intent.cancel',
      'telegram.bot.intent.consume'
    )
  );

COMMENT ON TABLE telegram_identities IS
  'Minimal Telegram subject to local user mapping; profile fields and credentials are excluded.';
COMMENT ON TABLE telegram_init_data_replays IS
  'Atomically consumed SHA-256 digests; Telegram initData is never persisted.';
COMMENT ON COLUMN telegram_bot_login_intents.token_hash IS
  'SHA-256 digest of the one-time Bot login token; plaintext tokens are never persisted.';

-- migrate:down
DELETE FROM access_audit_events
WHERE action IN (
  'telegram.mini_app.login',
  'telegram.bot.intent.create',
  'telegram.bot.intent.confirm',
  'telegram.bot.intent.cancel',
  'telegram.bot.intent.consume'
);

ALTER TABLE access_audit_events
  DROP CONSTRAINT access_audit_events_action_check;
ALTER TABLE access_audit_events
  ADD CONSTRAINT access_audit_events_action_check CHECK (
    action IN ('session.access', 'session.logout')
  );

DROP TABLE telegram_bot_login_intents;
DROP TABLE telegram_init_data_replays;
DROP TABLE telegram_identities;
