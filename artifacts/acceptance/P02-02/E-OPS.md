# E-OPS: Bounded replay and local operations

Evidence level: `local-fixture-verified` only.

The market data path is operationally bounded and recoverable within the local fixture environment:

- durable cursors resume indexing after process restart without changing prior metrics or sequence;
- the replay function orders epoch and sequence numerically and returns at most 500 rows per query;
- a 600-event integration fixture proves pagination without loss or duplication;
- retention misses create a new epoch and durable recovery snapshot instead of silently skipping data;
- heartbeats are persisted, sequenced, replayable outbox events;
- reorg tombstones precede replacement-branch diffs;
- PostgreSQL transactions and the chain advisory lock keep event, snapshot, cursor, and outbox changes atomic;
- local PostgreSQL, Redis, MinIO, and Anvil health checks pass without external RPC or target access.

The slice has no production decoder, RPC source, finality depth, target-source SLA, monitoring deployment, or production retention configuration. Those operational gaps remain unresolved and prevent parity or release claims.
