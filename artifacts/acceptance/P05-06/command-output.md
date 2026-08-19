# P05-06 Command Output

| Command / CI job equivalent | Result |
|---|---|
| `pnpm format:check` | passed |
| `pnpm lint` | passed |
| `pnpm typecheck` | passed |
| `pnpm build` | passed |
| `pnpm test` | passed |
| `pnpm test:postgres` | passed; 116 tests passed and 5 environment-skipped |
| `pnpm test:anvil` | passed; 5 real local integration tests including direct, Permit2, restart, Swap revert, and cleanup |
| `pnpm test:contracts` | passed; 21 tests, 256 fuzz cases, and 128,000 invariant calls |
| `pnpm test:e2e` | passed |
| `LPBOT_CAPTURE_P05_06=1 pnpm exec playwright test tests/e2e/p05-06-local-swap-execution.spec.ts` | passed; 8 desktop/mobile cases with keyboard, Axe, cleanup, and visual regression |
| `pnpm check:all` | passed |
| `node scripts/finalize-p05-06-acceptance.mjs` | passed; P05-03/04/05 byte identity and P05-06 checksums verified |
| `git diff 1bf9a68dfba1bb42ff558dfe3df1c5097ef6969a -- artifacts/acceptance/P05-03 artifacts/acceptance/P05-04 artifacts/acceptance/P05-05` | empty |

Execution counters: 3 local synthetic Swap operations, 7 local step signatures/broadcasts, 1 local Permit2 authorization signature, 7 canonical step receipts, 2 successful Swaps, 1 deliberate Swap revert followed by successful allowance cleanup, testnet signatures/broadcasts 0/0, production signatures/broadcasts 0/0, and real-fund operations 0.
