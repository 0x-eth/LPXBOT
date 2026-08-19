# E-DATA

Migration `20260819000300_create_swap_quotes_pricing_positions.sql` adds seven tables:

- `swap_quote_snapshots`
- `pricing_positions`
- `pricing_position_observations`
- `pricing_position_state_events`
- `pricing_position_withdrawn_tombstones`
- `pricing_position_stream_heads`
- `pricing_position_outbox`

All chain amounts and block numbers use integer `numeric(78,0)` values. Cost basis stores two base-unit amounts plus an all-or-none USD decimal, observation time, and source tuple. Missing price data remains `null/missing`; stale input keeps source/time but clears USD and becomes `null/stale`.

The position identity unique key binds tenant, user, wallet, chain, platform, PositionManager, and token ID. Quote, observation, state-event, tombstone, and Outbox history is append-only. Composite foreign keys retain tenant/user ownership, and public table privileges are revoked.

Import or state transition writes the position history, observation, stream head, and Outbox event in one PostgreSQL transaction. Concurrent duplicate import converges on one pricing position. A withdrawn state adds a tombstone; neither position history nor fee observations are deleted. Quote snapshots store controlled route metadata and `calldataDigest`, but raw calldata, secrets, OKX keys, and caller-supplied target addresses are never stored.

The migration-cycle integration passed all migrations up, all downs in reverse, a fresh connection, all ups again, and repeatable seed. Evidence: `tests/p05-pricing-position-migration.test.ts`, `tests/integration/postgres-migration-cycle.integration.ts`, and `tests/integration/postgres-pricing-position-store.integration.ts`.
