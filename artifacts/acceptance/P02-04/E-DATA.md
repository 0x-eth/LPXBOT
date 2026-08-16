# E-DATA

- `packages/api-contract` freezes Liquidity Flow schema `1.0.0`, protocols `pcsv3,univ3,pcsv4,univ4`, and event types `create,add,remove`.
- The P02-03 normalized Golden directory remains unchanged. All 16 records are replayed offline; only the 10 `pool.created`, `liquidity.add`, and `liquidity.remove` records enter the flow projection. Swap and collect-only records do not.
- Every projection is BSC chain 56 and has finality `observed`. NFT ID, USD value, and in-range are `null` because the Golden source is not authoritative for them.
- V4 `ModifyLiquidity` records whose Golden data has no token amount retain `amount0: null` and `amount1: null`; no token amount, USD value, NFT ID, in-range value, or finality is inferred.
- Migration `20260816000200_create_liquidity_flow.sql` adds constrained `liquidity_flow_events` and `liquidity_flow_outbox` tables plus canonical-order, filter, replay, and backfill indexes.
- The canonical raw log, normalized event, flow projection, replay outbox, market projection, and indexer cursor are committed under one PostgreSQL serializable transaction and advisory lock.
