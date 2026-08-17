# E-REC

- Contract tests cover BSC V3 address identity, V4 pool ID identity, canonical pool keys, mixed-case canonicalization, and invalid/fuzzy identity rejection.
- PostgreSQL integration covers same-operation/same-payload idempotency, different-payload conflict evidence, concurrent replay, adapter-recreation persistence, stable cursor pagination, and schema constraints.
- Multiple attempts and multiple users for one pool are retained. Attribution deterministically chooses the earliest `created`; only an all-`already_exists` history uses the earliest fallback warning.
- `already_exists` explicitly does not prove LPXBOT created the pool first. An absent row means either non-platform creation or creation before this feature was deployed.
- `golden/attribution.json` fixes the independent expected outcomes for earliest-created, fallback, no-record, and deleted-user cases.
- No recovery path mutates, replaces, or infers provenance from PoolCreated, Initialize, first Mint, catalog rows, token owners, transaction senders, or external data.

