# Command Output

Environment: local macOS fixture. Repository target Node 22.23.1; the desktop runner reported Node 26.5.0 and pnpm 11.17.0, so pnpm emitted the documented engine warning while all commands executed with the locked toolchain.

| Command | Observed result |
|---|---|
| focused P04-07 connector/API/client Vitest | pending final capture |
| `pnpm test:postgres` | 25 files passed, 1 skipped; 104 tests passed, 1 skipped; migration up/down/up |
| P04-07 Playwright capture | 6/6 desktop/mobile passed; Axe, keyboard, overflow, clearing, status states |
| full `pnpm test:e2e` | pending final capture |
| `pnpm test:pwa` | pending final capture |
| `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm build` | pending final capture |
| `pnpm test`, `pnpm check:all` | pending final capture |
| `pnpm test:contracts`, `pnpm test:anvil`, `pnpm test:infra` | pending final capture |
| `pnpm audit:dependencies` | pending final capture |
| `gitleaks git --config=.gitleaks.toml --redact .` | pending final capture |
| frozen prior acceptance inventory | 568 files pending final recheck |
| Real OKX requests | 0 |
