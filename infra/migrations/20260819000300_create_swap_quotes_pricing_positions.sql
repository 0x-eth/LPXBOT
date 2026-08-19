-- migrate:up

ALTER TABLE custody_wallets
  ADD CONSTRAINT custody_wallets_tenant_user_wallet_unique
  UNIQUE (tenant_id, user_id, wallet_id);

CREATE FUNCTION prevent_pricing_position_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'swap quote snapshots and pricing position history are append-only'
    USING ERRCODE = '55000';
END;
$$;

CREATE TABLE swap_quote_snapshots (
  quote_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL CHECK (
    tenant_id ~ '^[a-z0-9]([a-z0-9._:-]{0,126}[a-z0-9])?$'
  ),
  user_id uuid NOT NULL,
  wallet_id uuid NOT NULL,
  wallet_address text NOT NULL CHECK (wallet_address ~ '^0x[0-9a-f]{40}$'),
  chain_id bigint NOT NULL CHECK (chain_id = 56),
  platform_id integer NOT NULL CHECK (platform_id IN (1, 2, 4, 5)),
  token_in text NOT NULL CHECK (token_in ~ '^0x[0-9a-f]{40}$'),
  token_out text NOT NULL CHECK (token_out ~ '^0x[0-9a-f]{40}$'),
  amount_in_base_unit numeric(78, 0) NOT NULL CHECK (amount_in_base_unit > 0),
  amount_out_base_unit numeric(78, 0) NOT NULL CHECK (amount_out_base_unit > 0),
  min_out_base_unit numeric(78, 0) NOT NULL CHECK (
    min_out_base_unit >= 0 AND min_out_base_unit <= amount_out_base_unit
  ),
  slippage_bps integer NOT NULL CHECK (slippage_bps BETWEEN 0 AND 500),
  price_impact_bps integer NOT NULL CHECK (price_impact_bps BETWEEN 0 AND 10000),
  router text NOT NULL CHECK (router ~ '^0x[0-9a-f]{40}$'),
  spender text NOT NULL CHECK (spender ~ '^0x[0-9a-f]{40}$'),
  selector text NOT NULL CHECK (selector ~ '^0x[0-9a-f]{8}$'),
  calldata_digest text NOT NULL CHECK (calldata_digest ~ '^0x[0-9a-f]{64}$'),
  route_tokens jsonb NOT NULL CHECK (
    jsonb_typeof(route_tokens) = 'array' AND jsonb_array_length(route_tokens) >= 2
  ),
  pool_path jsonb NOT NULL CHECK (
    jsonb_typeof(pool_path) = 'array' AND jsonb_array_length(pool_path) >= 1
  ),
  gas_limit numeric(78, 0) NOT NULL CHECK (gas_limit > 0),
  gas_price_wei numeric(78, 0) NOT NULL CHECK (gas_price_wei > 0),
  estimated_fee_wei numeric(78, 0) NOT NULL CHECK (estimated_fee_wei > 0),
  provider_snapshot_id uuid NOT NULL,
  registry_version text NOT NULL CHECK (registry_version = 'p05-bsc-execution-v1'),
  observed_block_number numeric(78, 0) NOT NULL CHECK (observed_block_number >= 0),
  max_block_number numeric(78, 0) NOT NULL CHECK (
    max_block_number >= observed_block_number
  ),
  quoted_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  deadline timestamptz NOT NULL,
  digest_domain text NOT NULL CHECK (digest_domain = 'LPXBOT_SWAP_QUOTE'),
  digest_version integer NOT NULL CHECK (digest_version = 1),
  digest text NOT NULL CHECK (digest ~ '^0x[0-9a-f]{64}$'),
  execution_enabled boolean NOT NULL CHECK (execution_enabled = false),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (token_in <> token_out),
  CHECK (quoted_at < expires_at AND expires_at <= deadline),
  FOREIGN KEY (tenant_id, user_id, wallet_id)
    REFERENCES custody_wallets(tenant_id, user_id, wallet_id)
    ON DELETE CASCADE,
  UNIQUE (tenant_id, user_id, digest)
);

CREATE INDEX swap_quote_snapshots_user_created_idx
  ON swap_quote_snapshots (tenant_id, user_id, created_at DESC, quote_id DESC);

CREATE TRIGGER swap_quote_snapshots_append_only
BEFORE UPDATE OR DELETE ON swap_quote_snapshots
FOR EACH ROW EXECUTE FUNCTION prevent_pricing_position_history_mutation();

CREATE TABLE pricing_positions (
  pricing_id uuid PRIMARY KEY,
  tenant_id text NOT NULL CHECK (
    tenant_id ~ '^[a-z0-9]([a-z0-9._:-]{0,126}[a-z0-9])?$'
  ),
  user_id uuid NOT NULL,
  wallet_id uuid NOT NULL,
  wallet_address text NOT NULL CHECK (wallet_address ~ '^0x[0-9a-f]{40}$'),
  chain_id bigint NOT NULL CHECK (chain_id = 56),
  platform_id integer NOT NULL CHECK (platform_id IN (1, 2, 4, 5)),
  position_manager text NOT NULL CHECK (position_manager ~ '^0x[0-9a-f]{40}$'),
  token_id numeric(78, 0) NOT NULL CHECK (token_id >= 0),
  pool_address text CHECK (pool_address IS NULL OR pool_address ~ '^0x[0-9a-f]{40}$'),
  pool_id text CHECK (pool_id IS NULL OR pool_id ~ '^0x[0-9a-f]{64}$'),
  token0 text NOT NULL CHECK (token0 ~ '^0x[0-9a-f]{40}$'),
  token1 text NOT NULL CHECK (token1 ~ '^0x[0-9a-f]{40}$'),
  cost_amount0_base_unit numeric(78, 0) NOT NULL CHECK (cost_amount0_base_unit >= 0),
  cost_amount1_base_unit numeric(78, 0) NOT NULL CHECK (cost_amount1_base_unit >= 0),
  cost_usd_value_decimal numeric(38, 18),
  cost_price_observed_at timestamptz,
  cost_price_source text CHECK (
    cost_price_source IS NULL OR
    cost_price_source ~ '^[A-Za-z0-9]([A-Za-z0-9._:-]{0,126}[A-Za-z0-9])?$'
  ),
  cost_price_status text NOT NULL CHECK (
    cost_price_status IN ('current', 'missing', 'stale')
  ),
  imported_at timestamptz NOT NULL,
  CHECK ((pool_address IS NULL) <> (pool_id IS NULL)),
  CHECK (token0 <> token1),
  CHECK (
    (cost_price_status = 'missing' AND cost_usd_value_decimal IS NULL
      AND cost_price_observed_at IS NULL AND cost_price_source IS NULL)
    OR
    (cost_price_status = 'current' AND cost_usd_value_decimal IS NOT NULL
      AND cost_price_observed_at IS NOT NULL AND cost_price_source IS NOT NULL)
    OR
    (cost_price_status = 'stale' AND cost_usd_value_decimal IS NULL
      AND cost_price_observed_at IS NOT NULL AND cost_price_source IS NOT NULL)
  ),
  FOREIGN KEY (tenant_id, user_id, wallet_id)
    REFERENCES custody_wallets(tenant_id, user_id, wallet_id)
    ON DELETE CASCADE,
  UNIQUE (pricing_id, tenant_id, user_id),
  UNIQUE (tenant_id, user_id, wallet_id, chain_id, platform_id, position_manager, token_id)
);

CREATE INDEX pricing_positions_user_imported_idx
  ON pricing_positions (tenant_id, user_id, imported_at, pricing_id);

CREATE TRIGGER pricing_positions_append_only
BEFORE UPDATE OR DELETE ON pricing_positions
FOR EACH ROW EXECUTE FUNCTION prevent_pricing_position_history_mutation();

CREATE TABLE pricing_position_observations (
  observation_id uuid PRIMARY KEY,
  pricing_id uuid NOT NULL,
  tenant_id text NOT NULL,
  user_id uuid NOT NULL,
  page_snapshot_digest text NOT NULL CHECK (page_snapshot_digest ~ '^0x[0-9a-f]{64}$'),
  snapshot_digest text NOT NULL CHECK (snapshot_digest ~ '^0x[0-9a-f]{64}$'),
  block_number numeric(78, 0) NOT NULL CHECK (block_number >= 0),
  block_hash text NOT NULL CHECK (block_hash ~ '^0x[0-9a-f]{64}$'),
  observed_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL,
  liquidity_raw numeric(78, 0) NOT NULL CHECK (liquidity_raw >= 0),
  liquidity_amount0_base_unit numeric(78, 0) NOT NULL CHECK (
    liquidity_amount0_base_unit >= 0
  ),
  liquidity_amount1_base_unit numeric(78, 0) NOT NULL CHECK (
    liquidity_amount1_base_unit >= 0
  ),
  observed_fee0_base_unit numeric(78, 0) NOT NULL CHECK (observed_fee0_base_unit >= 0),
  observed_fee1_base_unit numeric(78, 0) NOT NULL CHECK (observed_fee1_base_unit >= 0),
  FOREIGN KEY (pricing_id, tenant_id, user_id)
    REFERENCES pricing_positions(pricing_id, tenant_id, user_id)
    ON DELETE CASCADE,
  UNIQUE (pricing_id, snapshot_digest)
);

CREATE INDEX pricing_position_observations_position_idx
  ON pricing_position_observations (pricing_id, observed_at, observation_id);

CREATE TRIGGER pricing_position_observations_append_only
BEFORE UPDATE OR DELETE ON pricing_position_observations
FOR EACH ROW EXECUTE FUNCTION prevent_pricing_position_history_mutation();

CREATE TABLE pricing_position_state_events (
  state_event_id uuid PRIMARY KEY,
  pricing_id uuid NOT NULL,
  tenant_id text NOT NULL,
  user_id uuid NOT NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  status text NOT NULL CHECK (status IN ('active', 'hidden', 'withdrawn')),
  created_at timestamptz NOT NULL,
  FOREIGN KEY (pricing_id, tenant_id, user_id)
    REFERENCES pricing_positions(pricing_id, tenant_id, user_id)
    ON DELETE CASCADE,
  UNIQUE (pricing_id, revision),
  UNIQUE (pricing_id, tenant_id, user_id, revision, status)
);

CREATE INDEX pricing_position_state_events_current_idx
  ON pricing_position_state_events (pricing_id, revision DESC);

CREATE TRIGGER pricing_position_state_events_append_only
BEFORE UPDATE OR DELETE ON pricing_position_state_events
FOR EACH ROW EXECUTE FUNCTION prevent_pricing_position_history_mutation();

CREATE TABLE pricing_position_withdrawn_tombstones (
  tombstone_id uuid PRIMARY KEY,
  pricing_id uuid NOT NULL,
  tenant_id text NOT NULL,
  user_id uuid NOT NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  status text NOT NULL CHECK (status = 'withdrawn'),
  created_at timestamptz NOT NULL,
  FOREIGN KEY (pricing_id, tenant_id, user_id, revision, status)
    REFERENCES pricing_position_state_events(
      pricing_id, tenant_id, user_id, revision, status
    ) ON DELETE CASCADE,
  UNIQUE (pricing_id)
);

CREATE TRIGGER pricing_position_withdrawn_tombstones_append_only
BEFORE UPDATE OR DELETE ON pricing_position_withdrawn_tombstones
FOR EACH ROW EXECUTE FUNCTION prevent_pricing_position_history_mutation();

CREATE TABLE pricing_position_stream_heads (
  tenant_id text NOT NULL CHECK (
    tenant_id ~ '^[a-z0-9]([a-z0-9._:-]{0,126}[a-z0-9])?$'
  ),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  epoch uuid NOT NULL DEFAULT gen_random_uuid(),
  next_sequence bigint NOT NULL DEFAULT 1 CHECK (next_sequence > 0),
  oldest_sequence bigint NOT NULL DEFAULT 1 CHECK (oldest_sequence > 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, user_id),
  CHECK (oldest_sequence <= next_sequence)
);

CREATE TABLE pricing_position_outbox (
  event_id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  user_id uuid NOT NULL,
  sequence bigint NOT NULL CHECK (sequence > 0),
  epoch uuid NOT NULL,
  pricing_id uuid NOT NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  event_type text NOT NULL CHECK (event_type IN ('diff', 'tombstone')),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  created_at timestamptz NOT NULL,
  FOREIGN KEY (pricing_id, tenant_id, user_id)
    REFERENCES pricing_positions(pricing_id, tenant_id, user_id)
    ON DELETE CASCADE,
  UNIQUE (tenant_id, user_id, sequence)
);

CREATE INDEX pricing_position_outbox_replay_idx
  ON pricing_position_outbox (tenant_id, user_id, sequence);

CREATE TRIGGER pricing_position_outbox_append_only
BEFORE UPDATE OR DELETE ON pricing_position_outbox
FOR EACH ROW EXECUTE FUNCTION prevent_pricing_position_history_mutation();

COMMENT ON TABLE swap_quote_snapshots IS
  'Non-executable quote observations; raw calldata and credentials are never stored.';
COMMENT ON TABLE pricing_positions IS
  'Immutable user cost basis and identity imported from a verified P05 position snapshot.';
COMMENT ON TABLE pricing_position_observations IS
  'Append-only chain snapshot observations; fee values are not represented as collected revenue.';
COMMENT ON TABLE pricing_position_outbox IS
  'Durable tenant and user scoped SSE recovery log.';

REVOKE ALL ON swap_quote_snapshots FROM PUBLIC;
REVOKE ALL ON pricing_positions FROM PUBLIC;
REVOKE ALL ON pricing_position_observations FROM PUBLIC;
REVOKE ALL ON pricing_position_state_events FROM PUBLIC;
REVOKE ALL ON pricing_position_withdrawn_tombstones FROM PUBLIC;
REVOKE ALL ON pricing_position_stream_heads FROM PUBLIC;
REVOKE ALL ON pricing_position_outbox FROM PUBLIC;

-- migrate:down

DROP TABLE pricing_position_outbox;
DROP TABLE pricing_position_stream_heads;
DROP TABLE pricing_position_withdrawn_tombstones;
DROP TABLE pricing_position_state_events;
DROP TABLE pricing_position_observations;
DROP TABLE pricing_positions;
DROP TABLE swap_quote_snapshots;
ALTER TABLE custody_wallets
  DROP CONSTRAINT custody_wallets_tenant_user_wallet_unique;
DROP FUNCTION prevent_pricing_position_history_mutation();
