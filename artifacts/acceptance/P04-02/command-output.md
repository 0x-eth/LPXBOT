# P04-02 Command Output

Environment: local macOS fixture, Node 22.23.1, pnpm 11.17.0, PostgreSQL `127.0.0.1:15432`, local Chromium, and local/injected KMS transports.

## Observed Gates

| Command | Result |
|---|---|
| focused signer/crypto/runtime/API/client/migration Vitest | 9 files / 36 tests passed |
| `pnpm format:check` | passed; all matched files use repository Prettier style |
| `pnpm lint` | passed; 15/15 workspace lint tasks plus root scripts/tests lint |
| `pnpm typecheck` | passed; 23/23 workspace tasks plus root TypeScript project |
| `pnpm test` | passed; 15/15 build tasks, 100 Vitest files / 631 tests, and 108 governance tests |
| `pnpm build` | passed; 15/15 workspace build tasks |
| `pnpm check:all` | passed; 196/196 feature IDs, 487 links, 27 manifests, and all frozen reference checks |
| `pnpm test:postgres` | 19 files / 86 tests passed, including full up/down/up and P04-02 concurrency/rollback/recovery |
| `pnpm test:infra` | 8/8 infrastructure tests passed |
| `pnpm test:e2e` | 183 passed / 23 project-configured skips; P04-02 desktop/mobile coverage passed 8/8 |
| `forge fmt --check && forge build && pnpm test:contracts` | passed; 3/3 contract tests |
| `LPBOT_CAPTURE_P04_02=1 pnpm exec playwright test tests/e2e/p04-02-wallets.spec.ts --workers=1` | 8/8 desktop/mobile tests passed; evidence screenshots captured |
| P04-01 AES-GCM/AAD/tamper/recovery replay | passed within focused signer tests |
| Gitleaks 8.30.1 full-history | 977 commits / approximately 22.92 MB / no leaks |
| `pnpm audit:dependencies` | no known vulnerabilities |
| owned-source, P04-02/Playwright, database, queue, and capability scans | source/artifact/Outbox capability matches 0; custody database rows `0|0|0` |
| prior acceptance comparison to `7f7403c4afdc095e243310a2ffc05983a0e3bc3c` | 0 changed P00-P04-01 files |

## Hosted CI

GitHub Actions run [32089913070](https://github.com/0x-eth/LPXBOT/actions/runs/32089913070) completed successfully for commit `2d8f0c84bc2151e97d8f8cbcfaca11808291fc14`. Quality, Governance, Browser, Contracts, Infrastructure, and Security all succeeded. The work item remains `accepted-with-gaps`, and the manifest commit remains null by governance contract.
