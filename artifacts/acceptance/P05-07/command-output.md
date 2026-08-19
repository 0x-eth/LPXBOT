# P05-07 Command Output

| Command / CI job equivalent | Result |
|---|---|
| `pnpm format:check` | passed |
| `pnpm lint` | passed |
| `pnpm typecheck` | passed |
| `pnpm build` | passed; 16/16 workspace packages |
| `pnpm test` | passed; Vitest 170 files / 954 tests and governance 181/181 |
| `pnpm test:postgres` | passed; 31 files / 117 tests with 6 files / 6 tests skipped |
| `pnpm test:anvil` | passed; 6 files / 6 tests with real non-forked Anvil local Position closure |
| `pnpm test:contracts` | passed; 26/26 across 5 suites, including 256-run fuzz and 128000 invariant calls |
| `pnpm test:e2e` | passed; 243 passed / 23 skipped across desktop and mobile |
| `LPBOT_CAPTURE_P05_07=1 pnpm exec playwright test tests/e2e/p05-07-local-position-execution.spec.ts` | passed; 8/8 desktop/mobile cases with keyboard, Axe, recovery, closed gate, and visual regression |
| `pnpm check:all` | passed |
| `node scripts/finalize-p05-07-acceptance.mjs` | passed; P05-02/03/04/05/06 byte identity and P05-07 checksums verified |
| `git diff c71791936d6382879e4c8342c50852030de9ab18 -- artifacts/acceptance/P05-02 artifacts/acceptance/P05-03 artifacts/acceptance/P05-04 artifacts/acceptance/P05-05 artifacts/acceptance/P05-06` | empty |

Execution evidence: platforms 1/2/4/5 each complete collect, partial decrease plus collect, and 100% decrease plus collect plus burn; 1/25/50/99/100 rounding transactions pass; one opaque ordered-plan operation closes with three canonical step receipts. BSC, testnet, and production signatures/broadcasts are 0/0; real-fund operations are 0.
