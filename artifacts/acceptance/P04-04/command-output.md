# P04-04 Command Output

Environment: local macOS fixture, Node 26.5.0, pnpm 11.17.0, PostgreSQL 17.10 client tooling, Playwright 1.62.1, local Chromium, and local/injected KMS, PostgreSQL, wallet, inventory, and task-coordinator fixtures.

| Command | Observed result |
|---|---|
| focused wallet lifecycle, security-password, signer, Keystore, tamper, password, and reset Vitest | 19 files / 93 tests passed |
| `pnpm test:postgres` | 22 files / 95 tests passed, including all migrations up/down/up |
| P04-02/P04-03/P04-04 Playwright regression | 24/24 passed |
| `LPBOT_CAPTURE_P04_04=1 pnpm exec playwright test tests/e2e/p04-04-wallet-security.spec.ts --workers=1` | 10/10 passed; four screenshots captured |
| Gitleaks 8.30.1 full-history | 1073 commits / approximately 23.47 MB / no leaks |
| `pnpm audit:dependencies` | no known vulnerabilities |
| P00-P04-03 acceptance comparison to `7814a13df07e179dd1b058b93a2a3dacce7fe42f` | 0 changed files |

Local Node 26.5.0 emits the repository's expected Node 22 engine warning. Hosted CI uses the pinned Node 22 toolchain.
