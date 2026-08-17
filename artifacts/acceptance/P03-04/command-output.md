# P03-04 Command Output

Environment: local macOS fixture, PostgreSQL `127.0.0.1:15432`, pnpm 11.17.0. The host Node runtime was 26.5.0, so pnpm printed the repository's Node 22 engine warning; commands used the pinned dependency graph.

## Focused Gates

| Command | Result |
|---|---|
| P03 Dispatcher/Webhook/Telegram/history/API/client/security Vitest | 11 files / 83 tests passed |
| P03-01 frozen reference plus P03 completion governance | 17/17 checks passed |
| `pnpm test:postgres` | 18 files / 83 tests passed, including migration up/down/up, Outbox recovery, selector regression, atomic history, retention, and privacy cascade |
| P03-04 desktop/mobile Playwright | 3 passed / 1 intentional mobile duplicate-state skip |
| `pnpm format:check` | passed |
| `pnpm lint` | 15 workspace packages plus repository ESLint passed |
| `pnpm typecheck` | 15 workspace packages plus root TypeScript passed |
| Gitleaks full-history scan | 923 commits, approximately 22.37 MB, no leaks |
| `pnpm audit:dependencies` | no known vulnerabilities |

## Complete Local Gates

| Command | Result |
|---|---|
| `pnpm test` | 15 workspace builds; 91 Vitest files / 595 tests; 87/87 Node governance tests passed |
| `pnpm build` | 15/15 workspace package builds passed |
| `pnpm check:all` | frozen baseline, 196 feature IDs, P00 definition, 452 documentation links, 26 manifests, and P02/P03 references passed |
| `pnpm test:e2e` | 175 passed / 23 intentional project skips across 198 desktop/mobile Playwright cases |
| `pnpm test:infra` | 8/8 local PostgreSQL, Redis, MinIO, Anvil, migration, seed, and log checks passed |
| `pnpm test:contracts` | 3/3 Foundry tests passed |
| P03-04 acceptance governance | 3/3 checks passed; 448 frozen prior files and 14 P03-04 evidence files verified |

## Fixture Boundary

Webhook resolution, HTTP/TLS requests, and Telegram transport were injected fixtures. Browser requests were locally intercepted. Real DNS, HTTP, TLS, or Telegram notification calls: 0.

## Hosted CI

The final evidence commit is verified by the six bounded GitHub Actions jobs after push. Hosted results remain distinct from the local results above.
