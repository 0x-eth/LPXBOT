# Command Output

All commands ran from `/Users/alpha/Projects/LPXBOT`. The local host uses Node 26.5.0 while CI pins Node 22.23.1; pnpm reports the engine mismatch.

| Command | Result |
|---|---|
| `pnpm exec vitest run` on the seven P05-03 unit/API/SSE/client/migration files | passed; 7 files / 32 tests |
| full Vitest suite with pnpm executable environment | passed; 152 files / 865 tests |
| `pnpm test:postgres` | passed; 27 files / 110 tests, 2 files / 2 tests skipped; migration up/down/up, concurrent import, and durable Outbox recovery covered |
| `LPBOT_CAPTURE_P05_03=1 pnpm exec playwright test tests/e2e/p05-03-swap-pricing.spec.ts` | passed; 2/2 desktop/mobile tests and two PNG captures |
| `pnpm format:check` | passed |
| `pnpm lint` | passed |
| `pnpm typecheck` | passed |
| `pnpm test` | passed; 152 Vitest files / 865 tests and 159/159 governance tests |
| `pnpm build` | passed |
| `pnpm check:all`, `pnpm check:p01-reference` | passed; 34 acceptance manifests, 196/196 feature IDs, and all frozen references valid |
| `pnpm test:e2e` | passed; 221 passed / 23 skipped |
| `pnpm test:pwa` | passed; 4/4 |
| `pnpm test:infra` | passed; 8/8 |
| `pnpm test:anvil` | passed; 2/2 controlled reads and zero transactions |
| `forge fmt --check`, `forge build`, `forge test -vvv` | passed; 4/4 contract tests |
| `pnpm audit:dependencies` | passed; no known vulnerabilities |
| `gitleaks git --config .gitleaks.toml --redact --no-banner .` | passed; 1,343 commits scanned and no leaks found |

The local equivalents of the six CI jobs, Quality, Governance, Browser, Contracts, Infrastructure, and Security, all passed. Signing, broadcast, chain writes, real-fund operations, and production calldata generation remained zero.
