# P02-10 command output

Verification used pnpm 11.17.0, the local PostgreSQL/Redis/MinIO/Anvil fixture stack, and macOS arm64. The local shell provided Node 26.5.0 and emitted the expected engine warning; GitHub Actions is pinned to Node 22.23.1.

```text
Focused projection/API/client: 3 files, 30 tests passed
Focused PostgreSQL Candle/Tick: 1 file, 5 tests passed
Legacy indexer/migration compatibility repro: 2 files, 16 tests passed
Focused P02-10 Playwright: 10 passed, 6 intentional project skips
Full Vitest: 64 files, 402 tests passed
Governance: 55/55 tests passed; focused P02 completion 21/21 passed
Full Playwright: 151 passed, 11 intentional project skips
PostgreSQL integration: 12 files, 51 tests passed
Foundry contracts: 3/3 tests passed
Infrastructure: 8/8 tests passed
Migration: first apply passed, second apply was a no-op, transactional down/up restore passed
format:check, lint, typecheck, test, build and check:all: passed
P02-01 through P02-09 acceptance files: 180/180 SHA-256 matches
Gitleaks 8.30.1 full-history: 675 commits, 20.80 MB, no leaks
Dependency audit: no known vulnerabilities
```

The focused browser suite generated and asserted the desktop/mobile captures after chart rendering, auto-refresh, SSE debounce, cancellation, keyboard, focus, overflow, following-row, canvas, and axe checks. The full browser run rewrote older screenshot fixtures as a test side effect; those files were restored from the frozen pre-P02-10 inventory and verified byte-for-byte.

No external RPC, production sample fetch, token metadata fetch, price fetch, signer, transaction broadcast, funds operation, business action, blocking rule, creator lookup, aTVL, Fee/aTVL, or STATS-01 implementation was used.
