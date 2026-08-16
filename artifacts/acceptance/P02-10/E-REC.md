# E-REC

- Exact duplicate canonical deliveries are ignored. Conflicting duplicate event IDs fail rather than silently replacing a projection input.
- The pure projector sorts deliberately shuffled events by canonical chain position, so OHLC, current tick, and liquidity boundaries do not depend on delivery order.
- PostgreSQL integration first commits two pools, then replays the same batch and verifies no read-model version increment for duplicates.
- The replacement test removes the old block-101 branch and applies its replacement. Only the affected pool's impacted one-minute and aggregate buckets, tick boundaries, state version, and canonical revision are rebuilt.
- After replacement, the old high-volume Candle and old liquidity boundaries are absent; the unrelated pool retains its original rows and version.
- Transaction fault injection interrupts Candle insertion and confirms canonical events, Candles, ticks, read-model state, and cursor all remain absent after rollback.
- Migration restore coverage executes the new migration down and up in a transaction and verifies all three tables disappear and return with their constraints.
- A dedicated compatibility regression commits projection-incomplete canonical events, verifies that no Candle/Tick values are invented, and retains the valid current tick and transaction cursor. The original market-indexer/migration repro passed 16/16; full PostgreSQL integration passed 12 files and 51 tests.
