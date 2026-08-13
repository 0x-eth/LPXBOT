# P01-02 command evidence

Recorded on 2026-08-14 (Asia/Shanghai).

## Local results

| Command | Observed result |
|---|---|
| `pnpm format:check` | passed; all matched files use Prettier |
| `pnpm lint` | passed; 13 workspace lint tasks plus root lint |
| `pnpm typecheck` | passed; 19 Turbo tasks plus root TypeScript |
| `pnpm build` | passed; 13 workspace build tasks |
| `pnpm test` with infrastructure stopped | passed; 55 Vitest tests and 19 governance tests |
| `pnpm test:e2e` | passed; 22 Chromium tests across desktop/mobile |
| `pnpm infra:up && pnpm db:migrate && pnpm db:migrate && pnpm db:seed && pnpm db:seed && pnpm infra:verify && pnpm test:infra && pnpm test:postgres && pnpm infra:down && pnpm infra:reset` | passed; repeatable migration/seed, 8 infrastructure tests, 1 real PostgreSQL integration test, and labeled-volume cleanup |
| clean-artifact `pnpm test:postgres` after deleting workspace `dist` | passed; dependency build plus 1 PostgreSQL test |
| `pnpm check:all && pnpm check:p01-reference` | passed; baseline, 196 IDs, P00, docs, acceptance, P01-01 |
| `pnpm audit:dependencies` | passed; no known vulnerabilities |
| local gitleaks | not run; binary was not installed |

## TDD red observations

Before implementation, focused tests failed for missing auth contract exports, missing account-policy functions, missing Fastify app/session interfaces, missing migration, missing PostgreSQL repository, missing web auth client, missing routes, duplicate restore requests, and guard status-code downgrading. Each focused suite was rerun to green before the next slice.

## CI result

`gh run watch 31733295804 --exit-status` returned success for commit `c638dad15c0c6d6a58777c6086d3ece318ceef48`.

Run: <https://github.com/0x-eth/LPXBOT/actions/runs/31733295804>

| Job | Result | Relevant gate |
|---|---|---|
| Quality | passed | format, lint, typecheck, unit/API, build |
| Governance | passed | frozen baseline, traceability, acceptance, P01-01 integrity |
| Browser | passed | Playwright desktop/mobile states, keyboard, axe |
| Infrastructure | passed | repeatable migration/seed, service tests, PostgreSQL sessions, cleanup |
| Security | passed | gitleaks repository scan and dependency audit |
| Contracts | passed | Solidity format, build, and 3 Foundry tests |
