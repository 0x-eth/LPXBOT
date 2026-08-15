# P02-02 local command results

Evidence level: `local-fixture-verified` only.

## Red phase

The first focused run failed because the indexer modules, market implementation, pool API, stream reducer, and `/pools` tracer did not exist. Later regression tests also failed before their fixes:

- complete migration cycle expected 13 tables but received the seven new market tables;
- decimal client ordering produced `9.9, 10` instead of `10, 9.9`;
- golden verification failed while P02-02 golden files were absent;
- stale old-branch duplicate replay returned `revertedCount=1`;
- 600-event replay returned sequence `10` before sequence `2` due text ordering;
- Playwright failed while desktop/mobile pool baselines were absent and after intentional visual changes.

## Focused green phase

| Gate | Result |
|---|---|
| Indexer runner and production fail-closed tests | passed; 5/5 |
| Arbitrary-precision market metrics | passed; 3/3 |
| Pool API plus existing stats stream regression | passed; 6/6 |
| Pool stream reducer | passed; 4/4 |
| Real PostgreSQL indexer/provider/golden suite | passed; 10/10 |
| Complete PostgreSQL migration cycle | passed; 1/1 |
| Pool Playwright states, keyboard, overflow, screenshots, and axe | focused runs passed on desktop/mobile |
| Root TypeScript after Decimal import fix | passed |

## Final gates

| Command | Result |
|---|---|
| `pnpm format:check` | passed |
| `pnpm lint` | passed; 13/13 workspace tasks |
| `pnpm typecheck` | passed; 19/19 workspace tasks |
| `pnpm test` | passed; 13/13 builds, 33 Vitest files with 177 tests, 36 governance tests |
| `pnpm build` | passed; 13/13 workspace tasks |
| `pnpm test:e2e` | passed; 92 tests, 4 project-specific skips |
| `pnpm db:migrate` twice | passed; second run was a no-op |
| `pnpm db:seed` twice | passed; deterministic tuple unchanged |
| Complete migration down/up cycle | passed; 1/1 |
| `pnpm test:postgres` | passed; 9 files with 30 tests |
| `pnpm infra:verify` | passed; PostgreSQL, Redis, MinIO, and Anvil healthy |
| `pnpm test:infra` | passed; 8/8 |
| `pnpm check:all` | passed; 196/196 traceability and all acceptance/reference checks |
| `forge fmt --check`; `forge build`; `forge test -vvv` | passed; 3/3 contract tests |
| Gitleaks full-history scan | passed; 385 commits, no leaks |
| `pnpm audit:dependencies` | passed; no known vulnerabilities |

The local shell used Node.js 26.5.0 and emitted the expected engine warning; CI uses the repository-pinned Node.js 22.23.1. Six-job GitHub Actions evidence is added only after a stable commit completes.
