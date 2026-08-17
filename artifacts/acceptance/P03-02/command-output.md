# P03-02 Command Output

Environment: local macOS fixture, PostgreSQL `127.0.0.1:15432`, pnpm 11.17.0. The host Node runtime was 26.5.0, so pnpm printed the repository's expected Node 22 engine warning; commands completed with the pinned dependency graph.

## Focused Gates

| Command | Result |
|---|---|
| monitor contract/API/client/evaluator/worker Vitest | 5 files / 41 tests passed |
| monitoring PostgreSQL plus migration cycle | 2 files / 7 tests passed |
| P03-02 desktop/mobile Playwright | 5 passed / 3 intentional mobile skips |
| P02-11 and shell Playwright regression | 17 passed / 3 intentional device skips |
| `pnpm db:migrate` twice | first application passed; immediate repeat was a no-op |
| P02/P03-01 integrity governance | 46 tests passed after restoring old screenshots |

## Repository Gates

| Command | Result |
|---|---|
| `pnpm format:check` | passed |
| `pnpm lint` | 14 workspace packages plus repository ESLint passed |
| `pnpm typecheck` | 14 workspace packages plus root TypeScript passed |
| `pnpm test` | pending final governance/status artifacts |
| `pnpm build` | pending standalone final run |
| `pnpm check:all` | pending final acceptance manifest |
| Gitleaks full history | pending |
| `pnpm audit:dependencies` | pending |
| GitHub Actions six jobs | pending |

No network notification delivery, signing, transaction broadcast, or funds operation ran.
