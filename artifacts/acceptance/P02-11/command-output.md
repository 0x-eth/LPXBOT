# P02-11 Command Output

Environment: macOS, Node.js 22.23.1, pnpm 11.17.0, PostgreSQL local fixture at `127.0.0.1:15432`. No external RPC, metadata, production sample, signing, broadcast, or funds endpoint was used.

## Red/Green Record

- Initial contract/policy run: failed as recorded in `initial-failure.md`, before the blocklist module and shared policy existed.
- Initial P02-11 governance run: 20 passed, 5 failed because POOL-13/14 were still planned and the P02-11 manifest, Golden, prior inventory, and checksum inventory did not exist.
- Final P02 governance run: 25 passed, 0 failed.
- During final gates, lint exposed a control-character regex rule, root typecheck exposed three overly broad fixture strings, and P01 governance exposed its old global planned count. Each was corrected without weakening runtime validation; the final commands below all passed.

## Focused Gates

| Command | Result |
|---|---|
| `pnpm exec vitest run` with 17 P02-11 policy/API/SSE/client and affected consumer files | 17 files, 90 tests passed |
| `pnpm db:migrate && pnpm db:migrate` | both completed; 14 applied, 0 pending |
| Focused blocklist store plus full migration-cycle integration | 2 files, 4 tests passed |
| `pnpm test:postgres` | 13 files, 54 tests passed |
| `pnpm exec playwright test tests/e2e/p02-11-pool-actions-blocklist.spec.ts --workers=1` | 4 passed, 2 intentional mobile skips |

## Repository Gates

| Command | Result |
|---|---|
| `pnpm format:check` | passed |
| `pnpm lint` | 14 package tasks and root ESLint passed |
| `pnpm typecheck` | 21 package tasks and root TypeScript passed |
| `pnpm test` | 71 Vitest files / 428 tests and 59 governance tests passed |
| `pnpm build` | 14 package build tasks passed |
| `pnpm check:all` | baseline, 196/196 traceability, P00, 347 doc links, 21 manifests, and P02 reference passed |
| `pnpm test:e2e` | 155 passed, 13 intentional skips, 0 failed |
| `gitleaks git --config .gitleaks.toml --redact --no-banner --verbose .` | 715 commits / approximately 21.02 MB scanned, no leaks |
| `pnpm audit:dependencies` | no known vulnerabilities |

## Integrity

- P02-01 through P02-10: 198/198 files match `prior-acceptance-sha256s.txt` and baseline `0856eefcfee1dd7adbfc5e13e34e0dbc0ddbf833` byte-for-byte.
- Full Playwright rewrote eight historical screenshots during execution; all eight were restored from the baseline before the 198/198 check.
- The focused and full P02-11 captures remain in `ui/` and are covered by `sha256sums.txt`.
