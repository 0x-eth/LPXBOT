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

## Stable-commit CI evidence

GitHub Actions [run 31912348949](https://github.com/0x-eth/LPXBOT/actions/runs/31912348949) passed Quality, Governance, Browser, Contracts, Infrastructure and Security for stable commit `73998c6f22e499f7063207ec1d497766b6714d29`. All six jobs received runners and executed their configured gates; the run completed at `2026-08-15T22:39:58Z`. Local and remote results remain distinct in [command-output.md](./command-output.md).
