# E-MIG: Reversible market-indexer schema

Evidence level: `local-fixture-verified` only.

Migration `20260816000100_create_market_indexer.sql` has explicit `-- migrate:up` and `-- migrate:down` sections and owns seven tables:

1. `canonical_chain_blocks`
2. `raw_chain_logs`
3. `normalized_pool_events`
4. `indexer_cursors`
5. `integrity_quarantine`
6. `market_snapshots`
7. `market_stream_outbox`

The schema constrains chain ID to 56, windows to 1/5/15/30/60, hashes and addresses to expected shapes, canonical uniqueness, positive version/epoch/sequence, and the dedupe key. Core integer quantities use `numeric(78,0)`.

Real PostgreSQL tests execute the market migration down and up inside an isolated transaction. The full migration-cycle suite runs every migration up, every down in reverse, reconnects across the Timescale extension boundary, runs every up again, and applies the seed twice. The expected public-table inventory includes all seven P02-02 tables.
