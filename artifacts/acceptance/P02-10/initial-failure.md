# P02-10 initial failures

Tests preceded each implementation slice. The durable red states were:

- Candle projection tests were added before the one-minute projector, deterministic aggregate bars, reciprocal OHLC direction, BigInt volume, empty-bucket omission, and duplicate timestamp checks existed.
- Tick projection tests initially lacked Mint/Burn and ModifyLiquidity boundary accounting, V4 pool ID identity, catalog spacing enforcement, negative ticks, zero-boundary removal, range selection, Decimal prices, and null-center behavior.
- API tests were red before both routes, strict parameter parsing, BSC-only validation, unique token resolution, authentication, read rate limits, safe 404/409/503 envelopes, and revision metadata were wired.
- Client tests initially had no strict response parser or request manager. The red cases demonstrated that an old request was not aborted and its late response could overwrite a newer pool/bar/range selection.
- PostgreSQL tests were introduced before the three read-model tables and transaction projector existed. Fault injection showed why canonical events, snapshots, cursor, Candles, and ticks must commit together.
- Reorg coverage was red until the projector rebuilt the replaced pool's affected one-minute and aggregate buckets and removed orphan liquidity boundaries without changing the unrelated pool.
- Playwright first found no expanded market detail. Subsequent red cases covered tab keyboard behavior, focus, auto-refresh, SSE debounce, cancellation, explicit state views, mobile overflow, following-row overlap, and axe.
- The mobile regression assertion initially observed the detail at a negative viewport x-coordinate after horizontal table scrolling. The detail-row viewport anchoring fixed that failure.
- The P02 governance test was updated before evidence creation. Its initial acceptance run passed 17 checks and failed four checks for the missing P02-10 manifest/contract, V3/V4 Golden, prior acceptance inventory, and P02-10 checksum inventory.

No frozen P02-01 through P02-09 acceptance file was edited while resolving these failures.
