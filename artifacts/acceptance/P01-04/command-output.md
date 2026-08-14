# P01-04 command evidence

Recorded on 2026-08-14 (Asia/Shanghai).

## Local results

| Command | Observed result |
|---|---|
| `pnpm format:check` | passed; all matched files use Prettier |
| `pnpm lint` | passed; 13 workspace lint tasks plus root lint |
| `pnpm typecheck` | passed; 19 Turbo tasks plus root TypeScript |
| `pnpm test` | passed; 17 Vitest files / 126 tests and 19 governance tests |
| focused P01-04 wallet suite | passed; 7 files / 50 tests |
| `pnpm build` | passed; 13 workspace build tasks |
| `pnpm test:e2e` | passed; 38 Chromium tests across desktop/mobile |
| `pnpm infra:up` | passed; PostgreSQL, Redis, MinIO, and Anvil healthy |
| `pnpm db:migrate` twice | passed; repeatable 4-migration schema |
| `pnpm db:seed` twice | passed; deterministic local seed |
| `pnpm infra:verify` | passed; all local services healthy |
| `pnpm test:infra` | passed; 8/8 infrastructure tests |
| `pnpm test:postgres` | passed; 3 files / 6 real PostgreSQL tests |
| `pnpm check:all` | passed; 248 frozen checksums, 196/196 IDs, P00, docs, and existing acceptance manifests |
| `pnpm check:p01-reference` | passed; 33 manifest records, 34 checksums, and 9 routes |
| `forge fmt --check`, `forge build`, `pnpm test:contracts` | passed; 3/3 local contract tests |
| Dockerized Gitleaks 8.30.0 | passed; 205 commits, approximately 17.98 MB, no leaks |
| `pnpm audit:dependencies` | passed; no known vulnerabilities |

## TDD sequence

The repository's minute-level auto-sync history preserves the red-before-green ordering:

| Test-first commit | Red contract introduced | First implementation commit |
|---|---|---|
| `03f28809d079dffdbcb79e5b273c901bdd30a94a` | wallet service tests; implementation module absent | `46d63b6cf08470a900da1c69c7675ca1f27ee53e` |
| `28c9ac1c5e384d052842581479612b1ac0c73e00` | wallet HTTP tests; routes absent | `21ecfcf10d1a5ab9711d1c217c2fe2489d8996de` |
| `01d5fe450f9941d26b4745cff6d3ab622b150a0a` | PostgreSQL wallet integration; schema/store absent | `5460441eb0e3a7c525640612763ea37058265354` |
| `777a2119e967a80a7e36a9753e3bc407cb34817b` | EIP-1193 adapter tests; adapter absent | `829f6cf4baad8b0fbd0c67c28917208974b7f5b2` |
| `151ed516a45f5a991cdbe27a0c43507f991927b2` | wallet Playwright workflow; UI absent | `82b09c97497a72b1a08b1ca3ca6389b21db2c26b` |

Green and refactor checkpoints then added binding isolation, label validation, rate limiting, migration rollback checks, domain-boundary scans, stable browser recovery, and final screenshots. The final local suites listed above all passed.

## CI result

GitHub Actions run [31787475239](https://github.com/0x-eth/LPXBOT/actions/runs/31787475239) passed for implementation commit `8f55a611002c31e30ec07c5da9a0cfd345b1f444`.

| Job | Result | Relevant gate |
|---|---|---|
| Quality | passed | format, lint, typecheck, 126 tests plus governance tests, build |
| Governance | passed | frozen baseline, traceability, P00, docs, existing acceptance, P01-01 integrity |
| Browser | passed | Playwright desktop/mobile, provider mock, rejection recovery, axe, keyboard |
| Contracts | passed | Solidity format, build, and 3 Foundry tests |
| Infrastructure | passed | repeatable migration/seed, health, 8 infra tests, 6 PostgreSQL tests, cleanup |
| Security | passed | full-history Gitleaks and dependency audit |

All wallet behavior is `local-fixture-verified`. EIP-1271 is `not-implemented/not-verified`. No real wallet, external RPC, target site, broadcast, authorization, funds action, or production write was used.
