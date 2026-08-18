# Command Output

Environment: local macOS fixture with the repository-locked Node 22.23.1 and pnpm 11.17.0. All provider and DNS behavior came from injected local transports with synthetic credentials.

| Command | Observed result |
|---|---|
| focused P04-07 connector/API/client Vitest | 7 files passed; 28 tests passed |
| `pnpm test:postgres` | 25 files passed, 1 skipped; 104 tests passed, 1 skipped; migration up/down/up |
| P04-07 Playwright capture | 6/6 desktop/mobile passed; Axe, keyboard, overflow, clearing, status states |
| full `pnpm test:e2e` | 215 passed, 23 project-conditional skipped, 0 failed; 238 total |
| `pnpm test:pwa` | 4 passed |
| `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm build` | passed; 16 lint tasks, 24 typecheck/build dependency tasks, 16 build tasks |
| `pnpm test`, `pnpm check:all` | 131 Vitest files / 777 tests and 133 governance tests passed; all baseline, traceability, documentation, acceptance, and reference checks passed |
| `forge fmt --check`, `forge build`, `pnpm test:contracts`, `pnpm test:anvil`, `pnpm test:infra` | passed; 4 contract tests, 1 Anvil integration test, 8 infrastructure tests |
| `pnpm audit:dependencies` | no known vulnerabilities |
| `gitleaks git --config .gitleaks.toml --redact --no-banner .` | 1,226 commits and 24.54 MB scanned; no leaks found |
| frozen prior acceptance inventory | all 568 files verified after the full Playwright run |
| Real OKX requests | 0 |
