# P01-03 command evidence

Recorded on 2026-08-14 (Asia/Shanghai).

## Local results

| Command | Observed result |
|---|---|
| `pnpm format:check` | passed; all matched files use Prettier |
| `pnpm lint` | passed; 13 workspace lint tasks plus root lint |
| `pnpm typecheck` | passed; 19 Turbo tasks plus root TypeScript |
| `pnpm test` | passed without Docker dependency; 11 Vitest files / 93 tests and 19 governance tests |
| `pnpm build` | passed; 13 workspace build tasks |
| focused Telegram unit/API suites | passed; verifier, Mini App, Bot service/API, Bot adapter, Web AuthClient, and migration coverage |
| `pnpm test:e2e` | passed; 28 Chromium tests across desktop/mobile |
| `pnpm infra:up` | passed; PostgreSQL, Redis, MinIO, and Anvil healthy |
| `pnpm db:migrate` twice | passed; repeatable 3-migration schema |
| `pnpm db:seed` twice | passed; deterministic local seed |
| `pnpm infra:verify` | passed; all local services healthy |
| `pnpm test:infra` | passed; 8/8 infrastructure tests |
| `pnpm test:postgres` | passed; 2 files / 4 real PostgreSQL tests |
| `pnpm check:all && pnpm check:p01-reference` | passed; baseline 248 checksums, 196/196 IDs, P00, docs, acceptance, and P01-01 integrity |
| `forge fmt --check && forge build && forge test -vvv` | passed; 3/3 local contract tests |
| Dockerized Gitleaks 8.30.0 | passed; 164 commits, approximately 17.81 MB, no leaks |
| `pnpm audit:dependencies` | passed; no known vulnerabilities |

## TDD red observations

- Concurrent Bot token creation initially produced three 200 responses because routes were registered before the rate-limit hook; after registration was deferred, the dependency's mutable concurrent counter snapshot produced three failures. The final bounded immutable-snapshot store yields 200, 200, and 429.
- Equivalent valid Mini App parameter order initially produced distinct replay digests and two 200 responses. Canonical parameter hashing changed the API result to one 200 and one 409.
- The infrastructure suite initially observed 3 migrations while the old assertion expected 2. The schema count and exact public-table list were updated for the single P01-03 migration.
- Root typecheck initially rejected DOM-only globals in shared test compilation. Browser adapters now use typed `globalThis` boundaries and explicit ESM extensions.

## CI result

GitHub Actions run [31781761117](https://github.com/0x-eth/LPXBOT/actions/runs/31781761117) passed for code commit `e452bec23a9ff061b441e97af75a22c7bbfad136`.

| Job | Result | Relevant gate |
|---|---|---|
| Quality | passed | format, lint, typecheck, unit/API tests, build |
| Governance | passed | frozen baseline, traceability, P00, docs, acceptance, P01-01 integrity |
| Browser | passed | Playwright desktop/mobile, keyboard, axe, cross-tab, recovery |
| Contracts | passed | Solidity format, build, and 3 Foundry tests |
| Infrastructure | passed | repeatable migration/seed, health, 8 infra tests, 4 PostgreSQL tests, cleanup |
| Security | passed | full-history Gitleaks and dependency audit |

All Telegram behavior is `local-fixture-verified`. Live Telegram execution was not performed.
