-- migrate:up

CREATE TABLE market_pool_catalog (
  pool_key text PRIMARY KEY CHECK (pool_key ~ '^56:0x(?:[0-9a-f]{40}|[0-9a-f]{64})$'),
  chain_id bigint NOT NULL CHECK (chain_id = 56),
  protocol text NOT NULL CHECK (protocol IN ('pcsv3', 'univ3', 'pcsv4', 'univ4')),
  protocol_generation text NOT NULL CHECK (protocol_generation IN ('v3', 'v4')),
  pool_address text CHECK (pool_address IS NULL OR pool_address ~ '^0x[0-9a-f]{40}$'),
  pool_id text CHECK (pool_id IS NULL OR pool_id ~ '^0x[0-9a-f]{64}$'),
  token0 text NOT NULL CHECK (token0 ~ '^0x[0-9a-f]{40}$'),
  token1 text NOT NULL CHECK (token1 ~ '^0x[0-9a-f]{40}$'),
  fee_pips numeric(78, 0) CHECK (fee_pips IS NULL OR fee_pips >= 0),
  tick_spacing numeric(78, 0),
  hooks text CHECK (hooks IS NULL OR hooks ~ '^0x[0-9a-f]{40}$'),
  first_observed_block numeric(78, 0) NOT NULL CHECK (first_observed_block >= 0),
  first_observed_at timestamptz NOT NULL,
  first_observed_transaction_hash text NOT NULL
    CHECK (first_observed_transaction_hash ~ '^0x[0-9a-f]{64}$'),
  created_event_id text NOT NULL REFERENCES normalized_pool_events (event_id),
  updated_at timestamptz NOT NULL,
  CHECK ((pool_address IS NULL) <> (pool_id IS NULL)),
  CHECK (
    (protocol_generation = 'v3' AND pool_address IS NOT NULL AND pool_id IS NULL) OR
    (protocol_generation = 'v4' AND pool_address IS NULL AND pool_id IS NOT NULL)
  )
);

CREATE INDEX market_pool_catalog_token0_lookup
  ON market_pool_catalog (chain_id, token0, protocol, pool_key);

CREATE INDEX market_pool_catalog_token1_lookup
  ON market_pool_catalog (chain_id, token1, protocol, pool_key);

COMMENT ON TABLE market_pool_catalog IS
  'Canonical normalized-event projection; reorg rebuilds never use external RPC data.';
COMMENT ON COLUMN market_pool_catalog.created_event_id IS
  'First canonical normalized event that established the complete local pool identity.';

-- migrate:down

DROP TABLE IF EXISTS market_pool_catalog;
