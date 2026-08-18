# P04-06 Command Output

Environment: local macOS fixture, repository target Node 22.23.1, local runner Node 26.5.0 (engine warning only), pnpm 11.17.0, Playwright 1.62.1, Gitleaks 8.30.1, local Chromium, PostgreSQL, Redis, MinIO, Foundry, and loopback Anvil.

| Command | Observed result |
|---|---|
| focused P04-06 API/domain/client/recovery/signer/runtime Vitest | 8 files / 41 tests passed |
| `pnpm test:postgres` | 24 files / 99 tests passed, 1 explicit skip; every migration up/down/up |
| `pnpm test:anvil` | 1/1 passed; native and ERC-20 balances, sequential nonce, receipts, canonical evidence, and Transfer log reconciled |
| `forge fmt --check`, `forge build`, `pnpm test:contracts` | passed; 4/4 contract tests |
| focused P04-06 Playwright with evidence capture | 6/6 desktop/mobile tests passed; four screenshots captured |
| `pnpm test:e2e` | 209 passed / 23 pre-existing conditional mobile skips / 0 failed |
| `pnpm test:pwa` | 4/4 passed |
| `pnpm test:infra` | 8/8 passed; PostgreSQL, Redis, MinIO, and Anvil healthy; migration and seed repeatable |
| `pnpm format:check`, `pnpm lint`, `pnpm typecheck` | passed; 15 lint tasks and 23 typecheck/build tasks |
| `pnpm build` | 15/15 package builds passed |
| `pnpm test` | 124 Vitest files / 747 tests and 128/128 governance tests passed |
| `pnpm check:all` | frozen baseline, 196/196 IDs, P00, 566 links, 31 manifests, and P02-P04 reference checks passed |
| `pnpm audit:dependencies` | no known vulnerabilities |
| `gitleaks git --config=.gitleaks.toml --redact .` | 1,178 commits / 24.18 MB scanned; no leaks found |
| fixed-baseline acceptance comparison | P00 through P04-05: zero changed files |
| Public RPC/testnet/mainnet/real-fund calls | 0 |

All final local gates completed after the P04-06 documents and governance assertions were finalized. GitHub Actions results are recorded separately after the branch push because they are remote execution evidence rather than local command output.
