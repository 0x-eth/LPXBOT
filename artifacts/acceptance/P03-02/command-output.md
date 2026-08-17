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
| `pnpm test:infra` | 8/8 passed, including the complete monitoring table inventory |
| `pnpm test:postgres` | 16 files / 72 tests passed |
| P02/P03-01 integrity governance | 46 tests passed after restoring old screenshots |

## Security

| Command | Result |
|---|---|
| Gitleaks full-history scan | 829 commits, approximately 21.80 MB, no leaks |
| `pnpm audit:dependencies` | no known vulnerabilities |

## Repository Gates

| Command | Result |
|---|---|
| `pnpm format:check` | passed |
| `pnpm lint` | 14 workspace packages plus repository ESLint passed |
| `pnpm typecheck` | 14 workspace packages plus root TypeScript passed |
| `pnpm test` | 14 package builds; 80 Vitest files / 512 tests; 80 Node governance tests passed |
| `pnpm build` | 14/14 workspace package builds passed |
| `pnpm check:all` | baseline, 196-feature traceability, P00, docs, 24 manifests, and P01/P02/P03 reference checks passed |
| Gitleaks full history | passed |
| `pnpm audit:dependencies` | passed |
| GitHub Actions six jobs | passed |

## GitHub Actions

Run: [32033703724](https://github.com/0x-eth/LPXBOT/actions/runs/32033703724)  
Commit: `accb3d0e21e35196e74274b1992c1b7341479bfe`

| Job | Conclusion |
|---|---|
| Quality | success |
| Infrastructure | success |
| Contracts | success |
| Browser | success |
| Security | success |
| Governance | success |

No network notification delivery, signing, transaction broadcast, or funds operation ran.
