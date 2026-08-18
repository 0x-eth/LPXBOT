# P04-06 Operations Evidence

Local write execution is opt-in twice: the chain must pass the existing account policy and appear in the API's explicit `walletTransferLocalChainIds`. The default list is empty. All other chains produce an approval-bound operation and stop before nonce allocation/signing/broadcast, preserving the R4 `READY_FOR_APPROVAL` boundary.

PostgreSQL is authoritative for command idempotency, nonce fencing, operation state, lineage, recovery leases, receipt evidence, and reconciliation. Redis may wake workers but cannot allocate a nonce or decide transaction state. Outbox creation is atomic with the operation and idempotency reservation.

Recovery workers claim bounded leases and can resume after process restart. Ambiguous broadcast timeout, already-known, missing transaction, consumed nonce, provider divergence, dropped transaction, fee replacement, canonical confirmation, and receipt-removal reorg all have explicit decisions. Unknown evidence remains reconciling and disables blind submission.

The raw broadcast adapter accepts only signer-produced bytes and a precomputed transaction identity. The observer uses configured local providers and compares their views. No request can supply a provider URL, arbitrary target, or arbitrary calldata.

Operational verification passed repeatable migration/seed, PostgreSQL up/down/up, 8/8 infrastructure tests, PostgreSQL/Redis/MinIO/Anvil health, full build/typecheck/lint/format, browser/PWA, Foundry, Gitleaks, and dependency audit.

Production RPC/provider deployment, KMS disaster recovery, independent signer/security review, custody monitoring/SLOs, staging rollback drills, and any testnet/mainnet approval remain unresolved. This work item is accepted-with-gaps, not parity-verified, not released, and not custody-ready.
