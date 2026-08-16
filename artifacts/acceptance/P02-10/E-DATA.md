# E-DATA

- `candle-tick-contract.json` freezes the locally-defined `candle-tick/local-v1` contract. Prices are raw token-relative ratios derived from canonical `sqrtPriceX96`; no value is described as USD.
- Canonical swaps are ordered by `blockNumber`, `transactionIndex`, `logIndex`, and `eventId`. The projector creates one-minute half-open UTC buckets first, then deterministically aggregates `5m`, `15m`, `1H`, `4H`, and `1D` buckets.
- OHLC uses the first, maximum, minimum, and last ordered price. Volume is the Decimal sum of absolute raw integer amounts for the selected base token. Empty time buckets are omitted without interpolation or forward fill.
- Token0 direction is token1-raw/token0-raw. Token1 direction takes the reciprocal and swaps high/low correctly. Wire values remain base-10 strings, with Decimal precision 96 and `ROUND_HALF_EVEN`.
- Mint/Burn and ModifyLiquidity apply `lower += liquidityDelta` and `upper -= liquidityDelta`. Zero final boundaries are removed and remaining boundaries are ordered by `tickIdx`.
- V3 identity is the pool address; V4 identity is `poolId`. The requested `tickSpacing` must equal the canonical pool catalog. Tick prices are Decimal strings only when both token decimals are valid.
- Migration `20260817000100_create_candle_tick_read_models.sql` adds constrained `market_candles`, `market_tick_liquidity`, and `market_read_model_states` tables with latest-Candle and range lookup indexes.
- Canonical events, affected Candle/Tick projections, read-model revision, snapshot work, and cursor update share the existing PostgreSQL transaction. The fault-injection integration test proves all rows roll back together.
- The normalized event schema permits null fields for older canonical fixtures. The PostgreSQL adapter keeps those events canonical while omitting only incomplete chart inputs; the strict pure projectors still reject incomplete direct input, and no Candle/Tick value is invented.
- `golden/v3.json` and `golden/v4.json` freeze negative/positive boundaries, BigInt liquidity and volume, price direction, V3/V4 identity, and unknown-decimals null behavior.
