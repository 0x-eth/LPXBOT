-- migrate:up

CREATE TABLE market_read_model_states (
  pool_key text PRIMARY KEY CHECK (pool_key ~ '^56:0x(?:[0-9a-f]{40}|[0-9a-f]{64})$'),
  chain_id bigint NOT NULL CHECK (chain_id = 56),
  canonical_revision text NOT NULL
    CHECK (canonical_revision ~ '^canonical:v1:[0-9a-f]{64}$'),
  version numeric(78, 0) NOT NULL CHECK (version > 0),
  as_of timestamptz NOT NULL,
  source text NOT NULL CHECK (source = 'canonical-events'),
  source_cursor text,
  current_tick integer,
  tick_spacing integer NOT NULL CHECK (tick_spacing > 0),
  updated_at timestamptz NOT NULL
);

CREATE TABLE market_candles (
  pool_key text NOT NULL CHECK (pool_key ~ '^56:0x(?:[0-9a-f]{40}|[0-9a-f]{64})$'),
  chain_id bigint NOT NULL CHECK (chain_id = 56),
  bar text NOT NULL CHECK (bar IN ('1m', '5m', '15m', '1H', '4H', '1D')),
  bucket_start timestamptz NOT NULL,
  open numeric NOT NULL CHECK (open > 0),
  high numeric NOT NULL CHECK (high > 0),
  low numeric NOT NULL CHECK (low > 0),
  close numeric NOT NULL CHECK (close > 0),
  volume0_raw numeric(78, 0) NOT NULL CHECK (volume0_raw >= 0),
  volume1_raw numeric(78, 0) NOT NULL CHECK (volume1_raw >= 0),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (pool_key, bar, bucket_start),
  CHECK (low <= open AND low <= close AND low <= high),
  CHECK (high >= open AND high >= close AND high >= low),
  CHECK (extract(microseconds FROM bucket_start) = 0)
);

CREATE INDEX market_candles_latest_lookup
  ON market_candles (pool_key, bar, bucket_start DESC);

CREATE TABLE market_tick_liquidity (
  pool_key text NOT NULL CHECK (pool_key ~ '^56:0x(?:[0-9a-f]{40}|[0-9a-f]{64})$'),
  chain_id bigint NOT NULL CHECK (chain_id = 56),
  tick_idx integer NOT NULL,
  liquidity_net numeric(78, 0) NOT NULL CHECK (liquidity_net <> 0),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (pool_key, tick_idx)
);

CREATE INDEX market_tick_liquidity_range_lookup
  ON market_tick_liquidity (pool_key, tick_idx);

COMMENT ON TABLE market_candles IS
  'Canonical local BSC sqrtPriceX96 Candle projection; prices are token-relative raw-unit ratios, never USD.';
COMMENT ON COLUMN market_candles.volume0_raw IS
  'Absolute token0 raw integer amount summed with Decimal arithmetic.';
COMMENT ON COLUMN market_candles.volume1_raw IS
  'Absolute token1 raw integer amount summed with Decimal arithmetic.';
COMMENT ON TABLE market_tick_liquidity IS
  'Canonical interval-boundary liquidityNet projection; no external RPC or token metadata.';

-- migrate:down

DROP TABLE IF EXISTS market_tick_liquidity;
DROP TABLE IF EXISTS market_candles;
DROP TABLE IF EXISTS market_read_model_states;
