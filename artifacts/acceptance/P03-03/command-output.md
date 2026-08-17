# P03-03 Command Output

Environment: local macOS fixture, PostgreSQL `127.0.0.1:15432`, pnpm 11.17.0. The host Node runtime was 26.5.0, so pnpm printed the repository's Node 22 engine warning; commands used the pinned dependency graph.

## Focused Gates

| Command | Result |
|---|---|
| notification API/client/template/signature/selector Vitest | 7 files / 27 tests passed |
| `pnpm test:postgres` | 17 files / 78 tests passed, including migration up/down/up, selector concurrency, transactional rollback, and P03-02 Outbox recovery |
| P03-03 desktop/mobile Playwright | 4 passed / 2 intentional mobile skips |
| complete Playwright suite | 172 passed / 22 intentional device skips |
| P03-01 frozen reference and webhook-security Golden replay | 13/13 governance checks passed; known-answer rendering/signing cases passed in focused Vitest |
| `pnpm test:infra` | 8/8 passed, including repeatable migration and complete notification table inventory |
| P00-P03-02 acceptance integrity | all 434 frozen files remained byte-identical to baseline `cf936a400a2ca05599e05bc7c181f14f9bd2cb88` |

## Repository And Security Gates

| Command | Result |
|---|---|
| `pnpm format:check` | passed |
| `pnpm lint` | 14 workspace packages plus repository ESLint passed |
| `pnpm typecheck` | 14 workspace packages plus root TypeScript passed |
| `pnpm test` | 14 package builds; 84 Vitest files / 528 tests; 84 Node governance tests passed |
| `pnpm build` | 14/14 workspace package builds passed |
| `pnpm check:all` | 196/196 feature IDs, 25 manifests, baseline/docs/P00/P02/P03 reference checks passed |
| Gitleaks full-history scan | 877 commits, approximately 22.13 MB, no leaks |
| `pnpm audit:dependencies` | no known vulnerabilities |

## GitHub Actions

Run: [32049355278](https://github.com/0x-eth/LPXBOT/actions/runs/32049355278)  
Commit: `35c4659b960f13babed33edf7f6aeafd945f1ebf`

| Job | Conclusion |
|---|---|
| Quality | success |
| Governance | success |
| Browser | success |
| Contracts | success |
| Infrastructure | success |
| Security | success |

Notification tests used only `local-sink://p03-01`. No DNS lookup, Telegram request, Webhook request, redirect, or other notification network operation ran.
