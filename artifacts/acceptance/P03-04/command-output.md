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

## Fixture Boundary

Webhook resolution, HTTP/TLS requests, and Telegram transport were injected fixtures. Browser requests were locally intercepted. Real DNS, HTTP, TLS, or Telegram notification calls: 0.

The complete repository, build, browser, infrastructure, governance, and hosted CI results are appended after this evidence snapshot is validated.
