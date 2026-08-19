# E-DATA

Migration `20260819000200_create_wallet_helper_read_models.sql` creates:

- `wallet_helper_bindings`, keyed to the custody wallet's composite `(user_id, wallet_id)` identity and restricted to chainId 56, Registry `p05-bsc-execution-v1`, and trusted `deployment-result` or `trusted-migration` sources.
- `wallet_helper_verification_snapshots`, an append-only record of owner, runtime code hash, selector set, version checks, canonical block, failures, and digest.
- `wallet_helper_residual_snapshots`, an append-only and database-idempotent record of allowlist version, coverage, residual items, canonical block, scan ID, and digest.

Database triggers reject update/delete mutation while still permitting parent-cascade cleanup. Composite foreign keys prevent cross-user binding or snapshot insertion. The residual unique key `(user_id, wallet_id, chain_id, idempotency_key)` serializes concurrent duplicate scans.

All on-chain amounts are stored and transported as decimal base-unit strings or `numeric(78,0)` values. No floating-point amount conversion is present in the read models. Position cursors bind user, wallet, chain, platform selection, Registry version, canonical block number/hash, and page offset through an authenticated digest.

`pnpm test:postgres` passed 26 files and 107 tests, with 2 environment-gated tests skipped. The global migration test exercised every migration up, all downs in reverse, a fresh connection, every up again, and repeatable seed. The Helper store suite covered restart recovery, immutable snapshots, tenant isolation, and concurrent idempotency.
