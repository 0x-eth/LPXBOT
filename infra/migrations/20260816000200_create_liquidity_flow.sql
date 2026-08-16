-- migrate:up

CREATE TABLE liquidity_flow_events (
  event_id text PRIMARY KEY REFERENCES normalized_pool_events (event_id) ON DELETE CASCADE,
  schema_version text NOT NULL CHECK (schema_version = '1.0.0'),
  chain_id bigint NOT NULL CHECK (chain_id = 56),
  block_number numeric(78, 0) NOT NULL CHECK (block_number >= 0),
  block_hash text NOT NULL CHECK (block_hash ~ '^0x[0-9a-fA-F]{64}$'),
  transaction_hash text NOT NULL CHECK (transaction_hash ~ '^0x[0-9a-fA-F]{64}$'),
  transaction_index bigint NOT NULL CHECK (transaction_index >= 0),
  log_index bigint NOT NULL CHECK (log_index >= 0),
  occurred_at_milliseconds bigint NOT NULL CHECK (occurred_at_milliseconds >= 0),
  protocol text NOT NULL CHECK (protocol IN ('pcsv3', 'univ3', 'pcsv4', 'univ4')),
  protocol_generation text NOT NULL CHECK (protocol_generation IN ('v3', 'v4')),
  event_type text NOT NULL CHECK (event_type IN ('create', 'add', 'remove')),
  finality text NOT NULL CHECK (finality IN ('observed', 'reverted')),
  canonical boolean NOT NULL DEFAULT true,
  source_cursor text NOT NULL,
  replay_cursor text NOT NULL UNIQUE,
  pool_address text CHECK (pool_address IS NULL OR pool_address ~ '^0x[0-9a-fA-F]{40}$'),
  pool_id text CHECK (pool_id IS NULL OR pool_id ~ '^0x[0-9a-fA-F]{64}$'),
  token0 text CHECK (token0 IS NULL OR token0 ~ '^0x[0-9a-fA-F]{40}$'),
  token1 text CHECK (token1 IS NULL OR token1 ~ '^0x[0-9a-fA-F]{40}$'),
  user_address text CHECK (user_address IS NULL OR user_address ~ '^0x[0-9a-fA-F]{40}$'),
  nft_id numeric(78, 0) CHECK (nft_id IS NULL OR nft_id >= 0),
  usd_value numeric,
  in_range boolean,
  amount0 numeric(78, 0),
  amount1 numeric(78, 0),
  liquidity_delta numeric(78, 0),
  record jsonb NOT NULL CHECK (jsonb_typeof(record) = 'object'),
  created_at timestamptz NOT NULL,
  reverted_at timestamptz,
  CHECK (pool_address IS NOT NULL OR pool_id IS NOT NULL)
);

CREATE INDEX liquidity_flow_events_canonical_order
  ON liquidity_flow_events (
    chain_id, block_number, transaction_index, log_index, transaction_hash, event_id
  )
  WHERE canonical;

CREATE INDEX liquidity_flow_events_filter
  ON liquidity_flow_events (
    chain_id, protocol, occurred_at_milliseconds, pool_address, pool_id,
    token0, token1, user_address, nft_id
  )
  WHERE canonical;

CREATE TABLE liquidity_flow_outbox (
  sequence numeric(78, 0) PRIMARY KEY CHECK (sequence > 0),
  chain_id bigint NOT NULL CHECK (chain_id = 56),
  cursor text NOT NULL UNIQUE,
  record_type text NOT NULL CHECK (record_type IN ('event', 'tombstone', 'heartbeat')),
  related_event_id text,
  occurred_at_milliseconds bigint NOT NULL CHECK (occurred_at_milliseconds >= 0),
  protocol text CHECK (protocol IS NULL OR protocol IN ('pcsv3', 'univ3', 'pcsv4', 'univ4')),
  protocol_generation text CHECK (protocol_generation IS NULL OR protocol_generation IN ('v3', 'v4')),
  event_type text CHECK (event_type IS NULL OR event_type IN ('create', 'add', 'remove')),
  pool_address text CHECK (pool_address IS NULL OR pool_address ~ '^0x[0-9a-fA-F]{40}$'),
  pool_id text CHECK (pool_id IS NULL OR pool_id ~ '^0x[0-9a-fA-F]{64}$'),
  token0 text CHECK (token0 IS NULL OR token0 ~ '^0x[0-9a-fA-F]{40}$'),
  token1 text CHECK (token1 IS NULL OR token1 ~ '^0x[0-9a-fA-F]{40}$'),
  user_address text CHECK (user_address IS NULL OR user_address ~ '^0x[0-9a-fA-F]{40}$'),
  nft_id numeric(78, 0) CHECK (nft_id IS NULL OR nft_id >= 0),
  payload jsonb,
  created_at timestamptz NOT NULL,
  CHECK (
    (record_type = 'heartbeat' AND payload IS NULL) OR
    (record_type <> 'heartbeat' AND jsonb_typeof(payload) = 'object')
  )
);

CREATE INDEX liquidity_flow_outbox_replay
  ON liquidity_flow_outbox (chain_id, sequence);

CREATE INDEX liquidity_flow_outbox_backfill
  ON liquidity_flow_outbox (
    chain_id, occurred_at_milliseconds, sequence, protocol, pool_address,
    pool_id, token0, token1, user_address, nft_id
  );

-- migrate:down

DROP TABLE IF EXISTS liquidity_flow_outbox;
DROP TABLE IF EXISTS liquidity_flow_events;
