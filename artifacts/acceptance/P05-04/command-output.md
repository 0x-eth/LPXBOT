# P05-04 Command Output

| Command / CI job equivalent | Result |
|---|---|
| `pnpm format:check` | passed |
| `pnpm lint` | passed |
| `pnpm typecheck` | passed; 24 tasks |
| `pnpm test` | passed |
| `pnpm build` | passed |
| `pnpm check:all` | passed |
| `forge fmt --check` and `forge build` | passed |
| `forge test -vvv` | passed; 21 tests, 256 fuzz runs, 128,000 invariant calls |
| `pnpm test:anvil` | passed; 3 files / 3 tests |
| `pnpm test:e2e` | passed |
| `pnpm test:infra` and `pnpm test:postgres` | passed |
| `gitleaks git --config .gitleaks.toml --redact --no-banner` | passed |
| `pnpm audit:dependencies` | passed; no known vulnerabilities |

Six CI jobs represented: Quality, Governance, Browser, Contracts, Infrastructure, and Security. Local Anvil accepted 17 synthetic transaction broadcasts, mined one deliberate revert, and completed 15 successful local chain writes. Testnet signatures/broadcasts, mainnet signatures/broadcasts, and real-fund operations each remained 0.
