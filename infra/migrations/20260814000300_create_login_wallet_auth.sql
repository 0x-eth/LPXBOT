-- migrate:up
CREATE TABLE auth_login_wallets (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  address bytea NOT NULL UNIQUE CHECK (octet_length(address) = 20),
  label text CHECK (label IS NULL OR (char_length(label) BETWEEN 1 AND 64)),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK (updated_at >= created_at)
);

CREATE INDEX auth_login_wallets_user_created_idx
  ON auth_login_wallets (user_id, created_at DESC);

CREATE TABLE auth_wallet_challenges (
  id_hash bytea PRIMARY KEY CHECK (octet_length(id_hash) = 32),
  nonce_hash bytea NOT NULL CHECK (octet_length(nonce_hash) = 32),
  message_hash bytea NOT NULL CHECK (octet_length(message_hash) = 32),
  address bytea NOT NULL CHECK (octet_length(address) = 20),
  chain_id bigint NOT NULL CHECK (chain_id > 0),
  purpose text NOT NULL CHECK (purpose IN ('login', 'link')),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CHECK (expires_at > issued_at),
  CHECK (consumed_at IS NULL OR consumed_at >= issued_at),
  CHECK (
    (purpose = 'login' AND user_id IS NULL)
    OR (purpose = 'link' AND user_id IS NOT NULL)
  )
);

CREATE INDEX auth_wallet_challenges_open_expiry_idx
  ON auth_wallet_challenges (expires_at)
  WHERE consumed_at IS NULL;
CREATE INDEX auth_wallet_challenges_user_issued_idx
  ON auth_wallet_challenges (user_id, issued_at DESC)
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
      'telegram.bot.intent.consume',
      'wallet.login',
      'wallet.link.challenge',
      'wallet.link.create',
      'wallet.link.delete'
    )
  );

COMMENT ON TABLE auth_login_wallets IS
  'Authentication identities used only for login; they confer no transaction or signer authority.';
COMMENT ON COLUMN auth_login_wallets.address IS
  'Normalized 20-byte EVM address for an authentication identity; never a private key or signer.';
COMMENT ON TABLE auth_wallet_challenges IS
  'Hash-only EIP-4361 login/link challenges; plaintext nonce, message and signature are never persisted.';

-- migrate:down
DELETE FROM access_audit_events
WHERE action IN (
  'wallet.login',
  'wallet.link.challenge',
  'wallet.link.create',
  'wallet.link.delete'
);

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

DROP TABLE auth_wallet_challenges;
DROP TABLE auth_login_wallets;
