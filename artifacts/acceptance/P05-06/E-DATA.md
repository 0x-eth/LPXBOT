# P05-06 E-DATA

Migration `20260820000100_create_local_swap_execution.sql` creates an isolated append-only local quote and execution ledger without changing `swap_quote_snapshots` or the BSC quote contract. Its 11 tables are:

- `local_swap_quote_snapshots`
- `local_swap_execution_previews`
- `local_swap_operations`
- `local_swap_operation_idempotency`
- `local_swap_operation_steps`
- `local_swap_step_transactions`
- `local_swap_replacement_authorizations`
- `local_swap_operation_outbox`
- `local_swap_reconciliation_cases`
- `local_swap_receipt_evidence`
- `local_swap_audit_events`

Database constraints fix chainId 31337, quote/Registry/plan versions, service fee 0, one live operation per wallet, ordered unique ordinals, unique reserved nonces, independent positive fencing tokens, one active transaction generation, immutable target/data/semantic digests, increasing replacement fees, one open reconciliation case, and append-only quote/receipt/audit evidence. Foreign keys bind every row to the tenant/user wallet, quote, operation, step, and transaction lineage.

`tests/integration/postgres-local-swap-execution.integration.ts` proves atomic quote/preview/submit, duplicate idempotency, conflict rejection, replacement lineage, restart lease reclaim, append-only evidence, cleanup activation, and the invariant that a reverted Swap remains `reconciling` until cleanup receipt evidence proves allowance zero. The complete PostgreSQL suite applies all migrations, rolls them down in reverse dependency order, reconnects, reapplies them, and seeds twice. It passes 116 tests with 5 environment-skipped cases.
