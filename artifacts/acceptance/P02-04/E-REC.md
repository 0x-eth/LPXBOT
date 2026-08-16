# E-REC

- Replaying the same delivery leaves one canonical event, one flow projection, and one event outbox row; aggregate state and cursors do not advance twice.
- Duplicate and out-of-order input is normalized by stable event ID and ordered by block number, transaction index, log index, transaction hash, and event ID.
- A reorg locks the affected canonical rows, appends tombstones in canonical order, marks the orphaned raw/normalized/flow rows reverted, rewinds the indexer cursor to the canonical ancestor, recomputes market projections, and then accepts replacement-branch events.
- Tombstone and replacement records share the durable outbox sequence. Retained-cursor reconnect replays them strictly in tombstone-before-replacement order.
- An injected transaction failure rolls back canonical event, flow projection, outbox, and cursor changes together.
- Historical backfill is bounded and tested with pool, token, user, NFT, empty-result, and retained-cursor cases without external RPC.
- PostgreSQL evidence is in `tests/integration/postgres-liquidity-flow.integration.ts`; migration down/up coverage is in `tests/integration/postgres-migration-cycle.integration.ts`.
