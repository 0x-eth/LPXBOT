# P04-03 Command Output

Environment: local macOS fixture, Node 26.5.0, pnpm 11.17.0, PostgreSQL 17.10 client tooling, Playwright 1.62.1, local Chromium, local/injected KMS, PostgreSQL, wallet, and dependency fixtures.

## Observed Gates

| Command | Result |
|---|---|
| focused P04 custody Vitest | 15 files / 69 tests passed |
| `pnpm test:postgres` | 20 files / 89 tests passed, including full migration up/down/up and P04-03 concurrency/rollback/restart recovery |
| `LPBOT_CAPTURE_P04_03=1 pnpm exec playwright test tests/e2e/p04-03-keystore.spec.ts --workers=1` | 6/6 desktop/mobile tests passed; four evidence screenshots captured |
| `pnpm exec playwright test tests/e2e/p04-02-wallets.spec.ts --workers=1` | 8/8 desktop/mobile regression tests passed |
| P04-01 Argon2id known answer and lifecycle-recovery replay | passed in focused tests |
| P04-02 AES-GCM, tamper, KMS failure, restart, and recovery regression | passed in focused tests |
| Gitleaks 8.30.1 full-history | 1022 commits / approximately 23.21 MB / no leaks |
| `pnpm audit:dependencies` | no known vulnerabilities |
| prior acceptance comparison to `0b01bae2a68da75837711c9901f42ff266000a6c` | 0 changed P00-P04-02 files |

The final repository-wide format, lint, typecheck, test, build, governance, and hosted six-job CI observations are recorded after the evidence inventory is complete.
