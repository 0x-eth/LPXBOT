# E-DATA

- `blocklist-action-contract.json` freezes schema version 1, chainId 56, canonical identities, deterministic entry ordering, revision semantics, and the label-independent SHA-256 eligibility hash.
- `user_pool_blocklist_state` owns one revision per user. `user_pool_blocklist_entries` uses the unique key `(user_id, scope, chain_id, identity)` and references the state row with cascading deletion.
- PostgreSQL CHECK constraints independently enforce BSC, scope, canonical lowercase Token/pool identity, label length/control-character rules, non-negative revision, and revision/update-time consistency.
- The adapter creates and locks the state row, verifies `expectedRevision`, changes one entry, increments revision, and reads the authoritative snapshot inside one transaction. Concurrent mutations from one revision therefore have one winner.
- Duplicate block and absent restore return without changing revision. Capacity is checked while the user revision row is locked.
- The store reconstructs sorted snapshots after adapter recreation; no process-local blocklist is authoritative.
- `golden/eligibility.json` freezes V3/V4 identities, token0/token1 blocking, missing/non-canonical address limitations, preserved candidate order, and post-filter limit backfill.
- Migration coverage runs the full first up, repeated up, reverse down, and restored up cycle; the user deletion test proves state and entries cascade together.
