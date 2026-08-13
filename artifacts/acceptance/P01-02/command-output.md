# P01-02 command evidence

Recorded on 2026-08-14 (Asia/Shanghai).

## Local results

| Command | Observed result |
|---|---|
| `pnpm format:check` | passed; all matched files use Prettier |
| `pnpm lint` | passed; 13 workspace lint tasks plus root lint |
| `pnpm typecheck` | passed; 19 Turbo tasks plus root TypeScript |
| `pnpm build` | passed; 13 workspace build tasks |
| `pnpm test` with infrastructure stopped | passed; 49 Vitest tests and 19 governance tests |
| `pnpm test:e2e` | passed; 22 Chromium tests across desktop/mobile |
| `pnpm test:infra` | passed; 8 infrastructure tests |
| `pnpm test:postgres` | passed; 1 real PostgreSQL integration test |
| clean-artifact `pnpm test:postgres` after deleting workspace `dist` | passed; dependency build plus 1 PostgreSQL test |
| `pnpm check:all && pnpm check:p01-reference` | passed; baseline, 196 IDs, P00, docs, acceptance, P01-01 |
| `pnpm audit:dependencies` | passed; no known vulnerabilities |
| local gitleaks | not run; binary was not installed |

## TDD red observations

Before implementation, focused tests failed for missing auth contract exports, missing account-policy functions, missing Fastify app/session interfaces, missing migration, missing PostgreSQL repository, missing web auth client, missing routes, duplicate restore requests, and guard status-code downgrading. Each focused suite was rerun to green before the next slice.

## CI result

Pending final acceptance SHA. No CI pass is claimed in this draft section.
