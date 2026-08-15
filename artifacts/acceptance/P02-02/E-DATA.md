# E-DATA: BSC single-pool tracer data path

Evidence level: `local-fixture-verified` only.

## Frozen input and normalization

The golden path replays the unchanged P02-01 `normal` and `reorg` fixtures in order. The test-only `FixtureEventDecoder` maps raw positions into versioned normalized events; it is not exported by the indexer package main entry. The committed evidence is:

- [Fixed input](golden/fixed-input.json)
- [Normalized events](golden/normalized-events.json)
- [Canonical PostgreSQL state](golden/canonical-store.json)

Production configuration recursively rejects `decoderFixtureId`. Missing verified ABI, topic, or protocol address fails closed. No synthetic topic or payload is treated as production decoder evidence.

## Canonical storage and precision

The migration creates canonical blocks, raw logs, normalized pool events, durable cursors, integrity quarantine, versioned market snapshots, and a replayable outbox. The dedupe key is `(chainId, blockHash, transactionHash, logIndex)`. Chain quantities and core decoded amounts use `numeric(78,0)`; market values remain decimal strings in JSON. JavaScript `number` is not used for market arithmetic.

`@lpbot/market-metrics` uses `decimal.js` with 96-digit precision and HALF_EVEN rounding configuration. All five UTC windows use `[start,end)`. Sorting compares unrounded decimal values, puts null last in both directions, then uses pool address and chain ID as deterministic ties.

## Metric output

[Five-window results](golden/window-results.json) contain 1, 5, 15, 30, and 60 minute outputs with Fees, Volume, TVL, unique transaction count, FDV, and Fee/TVL. The fixed swap produces exact `42.125` Fees and `9000.75` Volume. Reorg replacement deterministically changes the affected pool's point-in-time TVL and FDV.

`activeTvlUsd` and `feeActiveTvl` are always null. No aTVL value is inferred, and POOL-05 remains planned. FDV and TVL are fixture projections, not production-source claims.

## Unresolved provenance

`GAP-EVENT-ABI-TOPICS`, `GAP-EVENT-PROTOCOL-ADDRESSES`, `GAP-EVENT-AMOUNT-SIGNS`, `GAP-FINALITY-DEPTH`, `GAP-BLOCK-TIMESTAMP-SOURCE`, `GAP-METRIC-FDV-SOURCE`, and `GAP-METRIC-TVL-SNAPSHOT` remain unresolved.
