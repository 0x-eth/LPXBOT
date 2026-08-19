# P05-06 Initial Failure Record

The cleanup recovery test first exposed that a cleanup step with no canonical receipt could fall through to generic nonce-drift handling. That path could obscure the stronger invariant that an approval-confirmed failed Swap remains reconciling while allowance may exist. `apps/worker/src/local-swap-worker.ts` now treats missing, dropped, underconfirmed, or noncanonical cleanup evidence as `ALLOWANCE_CLEANUP_REQUIRED` and retains operation state `reconciling` until canonical allowance-zero evidence arrives.

The complete PostgreSQL suite then exposed two migration-fixture assumptions. The custody down/up test attempted to remove Helper deployment tables while P05-06 foreign keys still depended on them, and the migration-cycle expected table inventory omitted the 11 new local Swap tables. The fixture now runs the P05-06 down section first and asserts the complete table set on both up cycles.

These failures preceded the final passing focused unit/API/client tests, 116-test PostgreSQL suite, real Anvil direct/Permit2/revert-cleanup closure, desktop/mobile Playwright run, Foundry fuzz/invariants, and full repository gates.
