# Command Output

All commands ran from `/Users/alpha/Projects/LPXBOT`. The local host uses Node 26.5.0 while CI pins Node 22.23.1; pnpm reports the engine mismatch.

| Command | Result |
|---|---|
| `pnpm exec vitest run` on the seven P05-03 unit/API/SSE/client/migration files | passed; 7 files / 31 tests |
| focused PostgreSQL migration cycle | passed; all migrations up/down/up and repeatable seed |
| `LPBOT_CAPTURE_P05_03=1 pnpm exec playwright test tests/e2e/p05-03-swap-pricing.spec.ts` | passed; 2/2 desktop/mobile tests and two PNG captures |
| `pnpm format:check` | passed |
| `pnpm lint` | passed |
| `pnpm typecheck` | passed |
| `pnpm test` | passed |
| `pnpm build` | passed |
| `pnpm check:all`, `pnpm check:p01-reference` | passed |
| `pnpm test:e2e` | passed |
| `pnpm test:pwa` | passed |
| `pnpm test:postgres` | passed |
| `pnpm test:infra` | passed |
| `pnpm test:anvil` | passed; controlled reads and zero transactions |
| `forge fmt --check`, `forge build`, `forge test -vvv` | passed |
| `pnpm audit:dependencies` | passed; no known vulnerabilities |
| `gitleaks git --config .gitleaks.toml --redact --no-banner .` | passed; no leaks found |

The local equivalents of the six CI jobs, Quality, Governance, Browser, Contracts, Infrastructure, and Security, all passed. Signing, broadcast, chain writes, real-fund operations, and production calldata generation remained zero.
