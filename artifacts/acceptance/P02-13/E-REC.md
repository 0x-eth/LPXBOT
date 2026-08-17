# P02-13 Recovery Evidence

`pnpm test:postgres` passed 15 integration files and 66 tests.

P02-13 recovery cases cover:

- source snapshots published before backfill completion remain unreadable until readiness commits;
- a ready projection with no user row returns authoritative zeros;
- same revision/same payload is idempotent, older revision is stale, and same revision/different payload records one conflict without overwrite;
- concurrent users serialize through the global head and produce an exact aggregate;
- concurrent same-revision contenders produce one winner and conflict records for different payloads;
- multiple updates between polls collapse to the latest complete patch;
- a same-count source-revision advance produces no update, followed by a heartbeat;
- provider reconstruction preserves the stored sequence;
- user deletion publishes zero and advances the global sequence;
- inconsistent persisted hashes fail closed as `STATS_UNAVAILABLE`.
