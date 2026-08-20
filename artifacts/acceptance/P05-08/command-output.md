# P05-08 Command Output

| Command / CI job equivalent | Result |
|---|---|
| `pnpm format:check` | passed after formatting four P05-08 source/test files |
| `pnpm lint` | passed; 16/16 workspace packages plus scripts/tests |
| `pnpm typecheck` | passed; 24/24 tasks |
| `pnpm build` | passed; 16/16 workspace packages |
| focused P05-08 Vitest command | passed; 8 files / 37 tests |
| `pnpm test:postgres` | passed; 32 files / 118 tests, 7 files / 7 tests skipped |
| `pnpm test:anvil` | passed; 7 files / 7 tests with real non-forked Anvil Helper sweep closure |
| `LPBOT_CAPTURE_P05_08=1 pnpm exec playwright test tests/e2e/p05-08-local-helper-sweep.spec.ts` | passed; 6/6 desktop/mobile cases with keyboard, duplicate Enter, Axe, manual recovery, BSC read-only boundary, overflow, and visual regression |

Execution evidence: one three-asset mixed batch plus native, TestOnlyERC20, and WBNB single-asset batches produce six independently signed/broadcast local operations and six canonical receipts. Token Transfer/balance and native gas-adjusted balance reconciliation pass, followed by a clean full rescan. BSC, testnet, and production signatures/broadcasts are 0/0; real-fund operations are 0.
