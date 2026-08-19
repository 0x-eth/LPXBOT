# E-REC

Position recovery behavior is snapshot-based. Pagination returns stable ordering without duplicate token IDs; every cursor is bound to user, wallet, chain, platform scope, Registry version, block number, and block hash. A cursor replayed by another user/wallet or after a snapshot change is rejected. A reorg detected by the final canonical-hash read returns stale/partial evidence rather than silently combining blocks.

Provider failure is isolated per platform. Successful verified positions remain available with `partial` coverage, while failed or unverifiable NFT/Manager output is quarantined. Unknown NFTs, owner mismatch, wrong ABI/code hash, and malformed pool identity cannot enter the ready list.

Helper verification snapshots are append-only. A missing binding returns `undeployed`; owner/code/selector/version mismatches return `degraded`; same-chain version interpretation distinguishes active/superseded without comparing versions across chains. PostgreSQL restart tests recovered the latest binding and snapshot.

Residual POST scans use a database uniqueness constraint and an in-service in-flight guard. Concurrent requests with the same user/wallet/chain/idempotency key converge on one stored scan. Allowlist or inventory incompleteness returns `partial`; it never reports an authoritative empty result. PostgreSQL integration passed restart, concurrency, mutation rejection, and migration rollback/reapply coverage.
