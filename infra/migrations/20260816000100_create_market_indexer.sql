-- migrate:up

CREATE TABLE canonical_chain_blocks (
  chain_id bigint NOT NULL CHECK (chain_id = 56),
  block_number numeric(78, 0) NOT NULL CHECK (block_number >= 0),
  block_hash text NOT NULL CHECK (block_hash ~ '^0x[0-9a-fA-F]{64}$'),
  parent_hash text CHECK (parent_hash IS NULL OR parent_hash ~ '^0x[0-9a-fA-F]{64}$'),
  block_timestamp timestamptz NOT NULL,
  canonical boolean NOT NULL DEFAULT true,
  observed_at timestamptz NOT NULL DEFAULT now(),
  reverted_at timestamptz,
  PRIMARY KEY (chain_id, block_hash)
);

CREATE UNIQUE INDEX canonical_chain_blocks_height_unique
  ON canonical_chain_blocks (chain_id, block_number)
  WHERE canonical;

CREATE TABLE raw_chain_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chain_id bigint NOT NULL CHECK (chain_id = 56),
  block_number numeric(78, 0) NOT NULL CHECK (block_number >= 0),
  block_hash text NOT NULL,
  transaction_hash text NOT NULL CHECK (transaction_hash ~ '^0x[0-9a-fA-F]{64}$'),
  transaction_index bigint NOT NULL CHECK (transaction_index >= 0),
  log_index bigint NOT NULL CHECK (log_index >= 0),
  contract_address text NOT NULL CHECK (contract_address ~ '^0x[0-9a-fA-F]{40}$'),
  topics jsonb NOT NULL CHECK (jsonb_typeof(topics) = 'array'),
  data text NOT NULL CHECK (data ~ '^0x(?:[0-9a-fA-F]{2})*$'),
  removed boolean NOT NULL,
  canonical boolean NOT NULL DEFAULT true,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  raw_payload jsonb NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  reverted_at timestamptz,
  UNIQUE (chain_id, block_hash, transaction_hash, log_index),
  FOREIGN KEY (chain_id, block_hash)
    REFERENCES canonical_chain_blocks (chain_id, block_hash)
    ON DELETE CASCADE
);

CREATE INDEX raw_chain_logs_canonical_order
  ON raw_chain_logs (chain_id, block_number, transaction_index, log_index)
  WHERE canonical;

CREATE TABLE normalized_pool_events (
  event_id text PRIMARY KEY CHECK (event_id ~ '^[0-9a-f]{64}$'),
  schema_version text NOT NULL CHECK (schema_version = '1.0.0'),
  chain_id bigint NOT NULL CHECK (chain_id = 56),
  block_number numeric(78, 0) NOT NULL CHECK (block_number >= 0),
  block_hash text NOT NULL,
  block_timestamp timestamptz NOT NULL,
  transaction_hash text NOT NULL CHECK (transaction_hash ~ '^0x[0-9a-fA-F]{64}$'),
  transaction_index bigint NOT NULL CHECK (transaction_index >= 0),
  log_index bigint NOT NULL CHECK (log_index >= 0),
  contract_address text NOT NULL CHECK (contract_address ~ '^0x[0-9a-fA-F]{40}$'),
  protocol text NOT NULL CHECK (protocol IN ('pcsv3', 'univ3', 'pcsv4', 'univ4')),
  protocol_generation text NOT NULL CHECK (protocol_generation IN ('v3', 'v4')),
  kind text NOT NULL CHECK (kind IN ('pool.created', 'swap', 'liquidity.add', 'liquidity.remove', 'collect')),
  finality text NOT NULL CHECK (finality IN ('observed', 'confirmed', 'finalized', 'reverted')),
  canonical boolean NOT NULL DEFAULT true,
  cursor text NOT NULL,
  pool_address text CHECK (pool_address IS NULL OR pool_address ~ '^0x[0-9a-fA-F]{40}$'),
  pool_id text CHECK (pool_id IS NULL OR pool_id ~ '^0x[0-9a-fA-F]{64}$'),
  token0 text CHECK (token0 IS NULL OR token0 ~ '^0x[0-9a-fA-F]{40}$'),
  token1 text CHECK (token1 IS NULL OR token1 ~ '^0x[0-9a-fA-F]{40}$'),
  fee_pips numeric(78, 0) CHECK (fee_pips IS NULL OR fee_pips >= 0),
  tick_spacing numeric(78, 0),
  hooks text CHECK (hooks IS NULL OR hooks ~ '^0x[0-9a-fA-F]{40}$'),
  amount0 numeric(78, 0),
  amount1 numeric(78, 0),
  liquidity_delta numeric(78, 0),
  sqrt_price_x96 numeric(78, 0) CHECK (sqrt_price_x96 IS NULL OR sqrt_price_x96 >= 0),
  payload jsonb NOT NULL,
  market_data jsonb NOT NULL,
  raw_ref text,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  reverted_at timestamptz,
  UNIQUE (chain_id, block_hash, transaction_hash, log_index),
  CHECK (pool_address IS NOT NULL OR pool_id IS NOT NULL),
  FOREIGN KEY (chain_id, block_hash, transaction_hash, log_index)
    REFERENCES raw_chain_logs (chain_id, block_hash, transaction_hash, log_index)
    ON DELETE CASCADE
);

CREATE INDEX normalized_pool_events_metric_scan
  ON normalized_pool_events (chain_id, block_timestamp, block_number, transaction_index, log_index)
  WHERE canonical;

CREATE TABLE indexer_cursors (
  chain_id bigint PRIMARY KEY CHECK (chain_id = 56),
  block_number numeric(78, 0) NOT NULL CHECK (block_number >= 0),
  block_hash text NOT NULL CHECK (block_hash ~ '^0x[0-9a-fA-F]{64}$'),
  transaction_index bigint NOT NULL CHECK (transaction_index >= 0),
  log_index bigint NOT NULL CHECK (log_index >= 0),
  cursor text NOT NULL UNIQUE,
  updated_at timestamptz NOT NULL
);

CREATE TABLE integrity_quarantine (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id bigint NOT NULL CHECK (chain_id = 56),
  block_hash text NOT NULL CHECK (block_hash ~ '^0x[0-9a-fA-F]{64}$'),
  transaction_hash text NOT NULL CHECK (transaction_hash ~ '^0x[0-9a-fA-F]{64}$'),
  log_index bigint NOT NULL CHECK (log_index >= 0),
  existing_payload_hash text NOT NULL CHECK (existing_payload_hash ~ '^[0-9a-f]{64}$'),
  incoming_payload_hash text NOT NULL CHECK (incoming_payload_hash ~ '^[0-9a-f]{64}$'),
  existing_payload jsonb NOT NULL,
  incoming_payload jsonb NOT NULL,
  reason text NOT NULL CHECK (reason = 'same-key-different-payload'),
  status text NOT NULL CHECK (status = 'quarantined'),
  created_at timestamptz NOT NULL,
  UNIQUE (chain_id, block_hash, transaction_hash, log_index, incoming_payload_hash)
);

CREATE TABLE market_snapshots (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  stream_key text NOT NULL,
  chain_id bigint NOT NULL CHECK (chain_id = 56),
  window_minutes smallint NOT NULL CHECK (window_minutes IN (1, 5, 15, 30, 60)),
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  version numeric(78, 0) NOT NULL CHECK (version > 0),
  source_cursor text,
  snapshot_hash text NOT NULL CHECK (snapshot_hash ~ '^[0-9a-f]{64}$'),
  rows jsonb NOT NULL CHECK (jsonb_typeof(rows) = 'array'),
  canonical boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL,
  superseded_at timestamptz,
  UNIQUE (stream_key, version),
  CHECK (window_start < window_end)
);

CREATE UNIQUE INDEX market_snapshots_current_unique
  ON market_snapshots (stream_key)
  WHERE canonical;

CREATE TABLE market_stream_outbox (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  stream_key text NOT NULL,
  chain_id bigint NOT NULL CHECK (chain_id = 56),
  window_minutes smallint NOT NULL CHECK (window_minutes IN (1, 5, 15, 30, 60)),
  epoch numeric(78, 0) NOT NULL CHECK (epoch > 0),
  sequence numeric(78, 0) NOT NULL CHECK (sequence > 0),
  cursor text NOT NULL UNIQUE,
  event_type text NOT NULL CHECK (event_type IN ('pools.snapshot', 'pools.diff', 'heartbeat')),
  mode text NOT NULL CHECK (mode IN ('snapshot', 'diff')),
  envelope jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (stream_key, epoch, sequence)
);

CREATE INDEX market_stream_outbox_replay
  ON market_stream_outbox (stream_key, epoch, sequence);

-- migrate:down

DROP TABLE IF EXISTS market_stream_outbox;
DROP TABLE IF EXISTS market_snapshots;
DROP TABLE IF EXISTS integrity_quarantine;
DROP TABLE IF EXISTS indexer_cursors;
DROP TABLE IF EXISTS normalized_pool_events;
DROP TABLE IF EXISTS raw_chain_logs;
DROP TABLE IF EXISTS canonical_chain_blocks;

