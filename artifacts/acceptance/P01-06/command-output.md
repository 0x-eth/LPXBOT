# P01-06 command evidence

Recorded on 2026-08-14 (Asia/Shanghai).

## TDD red state

The test seams were fixed before implementation: authenticated preference HTTP API, real PostgreSQL, authenticated stats HTTP/SSE, browser theme/settings/navigation and strict screenshot comparison. Auto-sync commits `62cc50f` through `8a61597` contain the new failing tests before the corresponding source modules. Detailed failures and the pre-test anchor are recorded in `checks/initial-failure.md`.

Later full-gate red states also found issues that narrower package runs did not expose:

- Root lint/typecheck found API generator/normalization issues, React Fast Refresh/effect structure and strict test typing; the exact root commands now pass.
- Full browser smoke found an unhandled local SSE fixture request; it now uses a persistent cancellable fixture and still rejects every unexpected request failure.
- Infrastructure found a migration count fixed at four; it now verifies the complete migration-file version sequence and five-table migration history.
- Full browser execution exposed writes into P01-05 actual evidence; those files were restored and the historical write side effect was removed while retaining strict screenshots.

## Passing local results

| Command | Observed result |
|---|---|
| `pnpm format:check` | passed; all matched files use Prettier |
| `pnpm lint` | passed; 13 workspace lint tasks plus root ESLint |
| `pnpm typecheck` | passed; 19 Turbo tasks plus root TypeScript |
| `pnpm test` | passed; 25 Vitest files / 145 tests and 19 governance tests |
| `pnpm build` | passed; 13 workspace builds and PWA injectManifest output |
| `pnpm exec vitest run tests/user-preferences-api.test.ts tests/stats-sse-api.test.ts tests/shell-stats-client.test.ts tests/web-theme.test.ts` | passed; 4 files / 13 tests |
| `pnpm db:migrate && pnpm db:migrate` | passed; second migration run was a no-op |
| `pnpm db:seed && pnpm db:seed` | passed; deterministic seed applied twice |
| `pnpm infra:verify` | passed; PostgreSQL/Redis/MinIO/Anvil healthy |
| `pnpm test:infra` | passed; 8/8 |
| `pnpm test:postgres` | passed; 4 files / 8 tests against real PostgreSQL |
| `LPBOT_PLAYWRIGHT_PORT=43175 pnpm test:e2e` | passed; 65 tests and 3 intentional project skips |
| `pnpm test:pwa` | passed; 4/4 production preview tests |
| Linux no-update P01-06 screenshot run | passed; 2/2 in Playwright 1.62.1 official image |
| Darwin no-update P01-06 screenshot run | passed; 2/2 |
| P01-05 strict shell screenshot rerun | passed; 2/2 without historical writes |
| `forge fmt --check`, `forge build`, `pnpm test:contracts` | passed; 3/3 Foundry tests |
| `pnpm check:all`, `pnpm check:p01-reference` | passed; frozen baseline, 196 IDs, P00, docs, manifests and reference artifacts |
| Dockerized Gitleaks 8.30.0 | passed; 282 commits, about 18.46 MB, no leaks |
| `pnpm audit:dependencies` | passed; no known vulnerabilities |

## Browser coverage

The full run covers light, dark, system-light, system-dark, representative preset and custom accents; optimistic update/rollback/retry; navigation order/hide/reset; refresh/second-context persistence; desktop/mobile status display; widths 320/390/768/1024/1440; visible focus; keyboard actions; axe serious/critical zero; P01-04 wallet regression; and strict P01-05/P01-06 screenshots.

## CI result

[Run 31816356438](https://github.com/0x-eth/LPXBOT/actions/runs/31816356438) passed all six jobs for commit `f5d537c909499e22d65a0dfbb98f4f4a95473eb0`: Quality, Governance, Browser, Contracts, Infrastructure and Security. Browser passed 65 tests with 3 intentional project skips in the digest-pinned Playwright 1.62.1 Noble image. The manifest is accepted as of `2026-08-14T15:53:43Z`.
