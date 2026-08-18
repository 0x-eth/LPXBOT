# P04-06 Recovery Evidence

PostgreSQL is the nonce and transaction-state source of truth. `wallet_nonce_ledgers` serializes allocation by `(chain_id, wallet_id)` under transaction locks, advances a fencing token, and combines database constraints with a unique operation nonce. Concurrent creation produced exactly nonces 0 and 1, while an identical idempotent request returned its original operation.

Recovery coverage proves:

- queued work survives a worker instance restart;
- retryable signing/broadcast failure leaves a claim recoverable;
- `already-known` is accepted only with the precomputed transaction hash;
- a broadcast timeout first queries that hash and does not blindly resubmit an ambiguous transaction;
- provider pending/latest divergence, a nonce gap, and multi-provider disagreement enter reconciliation;
- a stale missing transaction becomes dropped only after nonce evidence is classified;
- confirmation requires a canonical successful receipt, matching hash/from/target/nonce, exact balance evidence, and an ERC-20 Transfer log when applicable;
- removal of a previously canonical receipt moves the operation back to reconciliation with `REORG_RECEIPT_REMOVED`;
- every signed hash in replacement lineage remains observable; if a historical transaction wins the nonce race, its canonical receipt promotes that transaction to the unique active confirmed head and marks the losing replacement dropped;
- pre-sign operations without an allocated nonce are excluded from transaction recovery claims.

Replacement authorization preserves operation, chain, wallet, nonce, recipient, amount, asset, calldata target/data/value, and deadline. Only the fee fields increase. PostgreSQL stores bidirectional generation lineage and enforces one active head; a mutated replacement recipient is rejected by the signer plan authorizer.

The PostgreSQL integration also demonstrated queued -> broadcast/already-known -> pending -> confirmed -> reconciling, persisted immutable receipt evidence, append-only enforcement, recovery leases, and the reauthenticated session binding through create, recovery claim, and replacement authorization.

Results: the focused recovery suite passed as part of 8 files / 41 tests. `pnpm test:postgres` passed 24 files / 99 tests with one explicitly skipped fixture and completed every migration up, all downs in reverse, and every up plus repeatable seed again.
