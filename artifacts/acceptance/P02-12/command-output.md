# P02-12 Command Output

Environment: macOS, Node.js 22.23.1 from `/opt/homebrew/opt/node@22/bin`, pnpm 11.17.0, PostgreSQL local fixture at `127.0.0.1:15432`. No external RPC, transaction-sender lookup, metadata, production sample, signing, broadcast, or funds endpoint was used.

## Red/Green Record

- The initial contract/API/client run failed before the provenance modules and routes existed; seven API assertions returned 404.
- The initial governance run reported 24 passed and 5 failed because POOL-15 and P02-12 acceptance ownership were absent.
- The initial focused UI run reported 5 failed because history, administrator markers, and the batch request were absent.
- The oversized batch test initially received HTTP 500 instead of no-store 413.
- These red results preceded implementation and are summarized in `initial-failure.md`.

## Focused Gates

| Command | Result |
|---|---|
| Focused P02-12 contract, API/RBAC and strict-client Vitest run | 3 files, 24 tests passed |
| `pnpm db:migrate` followed by the same command again | both completed successfully |
| Focused provenance store plus full migration-cycle integration | 2 files, 7 tests passed |
| `pnpm test:postgres` | 14 files, 60 tests passed |
| `pnpm exec playwright test tests/e2e/p02-12-pool-provenance.spec.ts --workers=1` | 6 passed, 4 intentional project skips, 0 failed |

## Repository Gates

| Command | Result |
|---|---|
| `pnpm format:check` | passed after mechanically formatting five new provenance files |
| `pnpm lint` | 14 package tasks plus root ESLint passed |
| `pnpm typecheck` | 21 package tasks plus root TypeScript passed |
| `pnpm test` | passed, including Vitest and governance suites |
| `pnpm build` | 14 package build tasks passed |
| `pnpm check:all` | baseline, traceability, P00, docs, acceptance manifests, and P02 reference checks passed |

The first repository typecheck exposed template-literal fixture types, a literal `100` parser parameter, an intentional sensitive-field fixture boundary, and a Playwright closure narrowing issue. Each was corrected without weakening runtime validation; the final typecheck passed.

## Security

| Command | Result |
|---|---|
| `gitleaks git --config .gitleaks.toml --redact --no-banner --verbose .` | 739 commits and approximately 21.21 MB scanned; no leaks found |
| `pnpm audit:dependencies` | no known vulnerabilities |

## Integrity and CI

- P02-01 through P02-11 contain 215 files. Every byte matches `prior-acceptance-sha256s.txt`, whose inventory digest is `35ac4650bd4fad5dba2c2010b4d2e422fe52231447e8b53f0cc989b334520337`.
- `sha256sums.txt` covers every P02-12 acceptance file except itself.
- GitHub Actions contains six jobs with executable steps: Quality, Governance, Browser, Contracts, Infrastructure, and Security. The final synchronized-main run was verified with all six conclusions `success`.
