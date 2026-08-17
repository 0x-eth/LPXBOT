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
| Gitleaks full-history scan | 760 commits, approximately 21.34 MB, no leaks |
| `pnpm audit:dependencies` | no known vulnerabilities |

## Integrity

P02-01 through P02-12 contain 231 files. Their current hashes exactly match `prior-acceptance-sha256s.txt`, whose inventory digest is `b909a0bbb2a2cf0e39097c279774a6cb15b45718e3ba605eec42844f47b79fb9`.

Repository-wide quality, build, governance, complete browser, and final GitHub Actions results are appended only after their final observed runs.
