# P02-13 Command Output

Environment: local macOS fixture, PostgreSQL at `127.0.0.1:15432`, pnpm 11.17.0. Runtime/data/browser tests made no external RPC, signing, broadcast, or funds call.

## Red/Green Record

- Initial focused Vitest: 25 tests, 17 passed and 8 failed; final focused Vitest: 42 passed.
- Initial PostgreSQL projection run: 5 failed because the schema was absent; final focused projection run: 6 passed.
- Initial P02 governance run: 28 passed and 5 failed because STATS-01 and P02-13 ownership were absent.
- The migration tracer initially caught one malformed seed row and then passed first application plus immediate repetition.

## Focused Gates

| Command | Result |
|---|---|
| focused projection/provider/API/SSE/RBAC/client Vitest | 4 files, 42 tests passed |
| focused projection PostgreSQL integration | 1 file, 6 tests passed |
| focused projection plus complete migration cycle | 2 files, 7 tests passed |
| `pnpm test:postgres` | 15 files, 66 tests passed |
| `pnpm exec playwright test tests/e2e/p02-13-shell-stats.spec.ts --workers=1` | 2 passed |

## Security

| Command | Result |
|---|---|
| Gitleaks full-history scan | 764 commits, approximately 21.37 MB, no leaks |
| `pnpm audit:dependencies` | no known vulnerabilities |

## Repository-Wide Gates

| Command | Result |
|---|---|
| `pnpm format:check` | passed |
| `pnpm lint` | 14 workspace packages plus repository ESLint passed |
| `pnpm typecheck` | 14 workspace packages plus root TypeScript passed |
| `pnpm test` | 14 package builds; 75 Vitest files / 471 tests; 67 Node governance tests passed |
| `pnpm build` | 14/14 workspace package builds passed |
| `pnpm check:all` | baseline, 196-feature traceability, P00, docs, 23 manifests, and P02 reference checks passed |
| `pnpm test:e2e` | 163 passed, 17 intentionally skipped; desktop/mobile and axe coverage passed |
| Linux visual baseline verification | 4 targeted tests passed in the pinned Playwright container |
| `pnpm test:infra` | 8/8 passed, including repeatable migration and seed execution |
| `pnpm test:postgres` | 15 files / 66 tests passed |

The focused migration run applied the complete schema twice successfully. The projection plus migration-cycle run passed 7/7 tests, including concurrent publication and complete down/up recovery.

## GitHub Actions

Run [32012814338](https://github.com/0x-eth/LPXBOT/actions/runs/32012814338) completed successfully at `4a4dd0f746ea6afd243a3f6cbda1af152e717379`:

| Job | Result | Actual gate |
|---|---|---|
| Quality | success | format, lint, typecheck, test, build |
| Governance | success | baseline, matrices, P00, docs, manifests, P01/P02 references |
| Browser | success | full Playwright suite in pinned Linux container |
| Contracts | success | Foundry format, build, and tests |
| Infrastructure | success | startup, repeatable migration/seed, health, infra and PostgreSQL tests |
| Security | success | full-history Gitleaks and dependency audit |

## Integrity

P02-01 through P02-12 contain 231 files. Their current hashes exactly match `prior-acceptance-sha256s.txt`, whose inventory digest is `b909a0bbb2a2cf0e39097c279774a6cb15b45718e3ba605eec42844f47b79fb9`.

P02 closes with 23 `implemented-assumed` features and 0 `planned` features while remaining `accepted-with-gaps`. Existing formula, live-parity, finality, and other recorded gaps remain open. The task business domain is not connected in this slice; an unready normal source returns `503 STATS_UNAVAILABLE` and is never represented as a fabricated zero snapshot.
