# P05-05 Command Output

| Command / CI job equivalent | Result |
|---|---|
| `pnpm format:check` | passed |
| `pnpm lint` | passed |
| `pnpm typecheck` | passed |
| `pnpm build` | passed |
| `pnpm test` | passed |
| `pnpm test:postgres` | passed |
| `pnpm test:anvil` | passed; real local Helper success, restart recovery, revert, and next-nonce retry |
| `pnpm test:e2e` | passed |
| `LPBOT_CAPTURE_P05_05=1 pnpm exec playwright test tests/e2e/p05-05-helper-deployment.spec.ts` | passed; 6 desktop/mobile cases with Axe and visual regression |
| `pnpm check:all` | passed |
| `node scripts/finalize-p05-05-acceptance.mjs` | passed; P05-04 byte identity and P05-05 checksums verified |
| `git diff ad695e0afbcbc84096a9b97ee48e6161031305cc -- artifacts/acceptance/P05-04` | empty |

Execution counters: local synthetic Helper signatures 2, local synthetic Helper broadcasts 2, successful Helper deployments 1, deliberate reverted Helper deployments 1, testnet signatures/broadcasts 0/0, production signatures/broadcasts 0/0, and real-fund operations 0.
