# P05-07 E-DATA

Migration `20260820000200_create_local_position_execution.sql` adds 13 isolated local Position tables without modifying the P05-02 through P05-06 acceptance artifacts or the previous Swap/Helper ledgers:

- `local_position_snapshots`
- `local_position_execution_previews`
- `local_position_operations`
- `local_position_operation_idempotency`
- `local_position_operation_steps`
- `local_position_step_transactions`
- `local_position_replacement_authorizations`
- `local_position_receipt_evidence`
- `local_position_proceeds_events`
- `local_position_pricing_completions`
- `local_position_reconciliation_cases`
- `local_position_operation_outbox`
- `local_position_audit_events`

The snapshot row binds tenant/user/wallet, wallet owner and approval, platform/tokenId, V3 pool address or V4 poolId, ticks, liquidity, reserves, tokens owed, Manager ABI/runtime identity, both token code identities, observed block number/hash, Registry digest, expiry, and the complete `p05-local-position-snapshot-v2` payload. Snapshot, preview, receipt, proceeds, and audit evidence is append-only. All public privileges are revoked.

Submit locks and reuses the existing `wallet_nonce_ledgers` row, compares the provider nonce, reserves consecutive nonces, increments a distinct fencing token per step, and persists each semantic digest, transaction-data digest, fixed Manager target/value, gas limit, fee ceiling, plan and replacement lineage. Constraints permit one active generation per step, require replacement fee monotonicity, and prevent duplicate nonces for a wallet.

`local_position_proceeds_events` classifies collect amounts already owed as fee proceeds and decrease amounts as principal. Principal is first recorded `pending-collect` and becomes `available` only with canonical collect evidence. `local_position_pricing_completions` links only a completed 100% removal to the P05-03 withdrawn state event and tombstone; partial or collect-only operations cannot mark the position withdrawn.

`tests/integration/postgres-local-position-execution.integration.ts` proves atomic snapshot/preview/submit, cursor recovery after confirmed decrease, collect replacement lineage, burn restart, append-only receipts, fee/principal classification, availability transition, and one final pricing completion. The complete PostgreSQL migration suite applies all migrations, reverses them in dependency order, reconnects, reapplies, and seeds twice.
