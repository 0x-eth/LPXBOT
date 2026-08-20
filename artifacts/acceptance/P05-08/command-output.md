# P05-08 Command Output

| Command / CI job equivalent | Result |
|---|---|
| `pnpm format:check` | passed; all repository files match Prettier style |
| `pnpm lint` | passed; 16/16 workspace packages plus scripts/tests |
| `pnpm typecheck` | passed; 24/24 tasks |
| `pnpm build` | passed; 16/16 workspace packages |
| focused P05-08 Vitest command | passed; 8 files / 37 tests |
| `pnpm test:postgres` | passed; 32 files / 118 tests, 7 files / 7 tests skipped |
| `pnpm test:anvil` | passed; 7 files / 7 tests with real non-forked Anvil Helper sweep closure |
| `LPBOT_CAPTURE_P05_08=1 pnpm exec playwright test tests/e2e/p05-08-local-helper-sweep.spec.ts` | passed; 6/6 desktop/mobile cases with keyboard, duplicate Enter, Axe, manual recovery, BSC read-only boundary, overflow, and visual regression |
| `pnpm test` | passed; 16/16 package builds, 178/178 Vitest files with 991/991 tests, and 187/187 governance tests |
| `pnpm test:contracts` | passed; 5 Foundry suites / 26 tests, including 256-run Helper invariants |
| `pnpm test:e2e` | passed; 249 Playwright cases and 23 project-configured skips across desktop/mobile projects |
| P05-02 through P05-08 governance command | passed; 38/38 tests |
| `pnpm check:all` | passed; baseline, 196/196 traceability, docs, 39 acceptance manifests, and P00/P02/P03/P04/P05 reference gates |
| `pnpm finalize:p05-08` | passed; 16 P05-08 files checksummed and P05-02 through P05-07 byte-identical to baseline `7123512a720ad983bee2f9aee095f663fefc474f` |

Execution evidence: one three-asset mixed batch plus native, TestOnlyERC20, and WBNB single-asset batches produce six independently signed/broadcast local operations and six canonical receipts. Token Transfer/balance and native gas-adjusted balance reconciliation pass, followed by a clean full rescan. BSC, testnet, and production signatures/broadcasts are 0/0; real-fund operations are 0.
