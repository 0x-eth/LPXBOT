# P02-07 command output

Verification ran on `2026-08-16` with Node `22.23.1`, pnpm `11.17.0`, macOS `15.7.4` arm64, and the repository PostgreSQL fixture.

```text
Focused unit/API/SSE/preferences: 11 files, 62 tests passed
Focused P02-07 Playwright: 6 passed across desktop/mobile
Full Playwright regression: 130 passed, 4 skipped
Repeated migration and seed: passed
PostgreSQL integration: 11 files, 43 tests passed
P02-01 through P02-06 acceptance files: 132/132 SHA-256 matches
Gitleaks 8.30.1 full-history: 571 commits, 20.29 MB, no leaks
Dependency audit: no known vulnerabilities
```

## Final local gates

```text
pnpm format:check: passed
pnpm lint: 14/14 tasks passed
pnpm typecheck: 21/21 tasks passed
pnpm test: build 14/14; Vitest 53/53 files and 323/323 tests; governance 43/43
pnpm build: 14/14 tasks passed
pnpm check:all: passed; 196/196 feature IDs and 17/17 manifests valid
pnpm test:infra: 8/8 passed
pnpm test:postgres: 11/11 files and 43/43 tests passed
pnpm test:contracts: 3/3 Foundry tests passed
```

The first full browser invocation received an argument separator that left Playwright on its normal five-worker local setting; all 130 runnable tests passed. The dedicated P02-07 gate had already run explicitly with one worker and passed 6/6.

No external RPC, production secret, signature, transaction broadcast, funds operation, metadata lookup, price lookup, creator lookup, label algorithm, candle, or tick sample was used.

## GitHub Actions runner provenance

The accepted evidence is run [`31949479544`, attempt 2](https://github.com/0x-eth/LPXBOT/actions/runs/31949479544/attempts/2) for commit `77becadfc63203cdc47a8b2fab3b122cde812ebd`, completed `2026-08-16T13:32:43Z`. All six Jobs executed real steps on repository runner ID `24`, name `p02-07-colima-arm64`, runner group `Default`, labels `self-hosted`, `Linux`, `ARM64`, `p02-07-arm64`, runner version `2.336.0`.

The temporary runner executed inside Colima `0.10.3`, Ubuntu `24.04.4 LTS` arm64, Linux `6.8.0-117-generic`, 4 CPUs, 8 GB RAM, and Docker server `29.5.2`, hosted by macOS `15.7.4` arm64. This is self-hosted GitHub Actions provenance, not a local-equivalent substitution.

```text
Quality        job 95171738430  success  13 steps  format; lint; typecheck; 323/323 Vitest; 43/43 governance; build
Governance     job 95171738543  success  15 steps  baseline; 196 IDs; docs; 17 manifests; P01/P02 reference checks
Browser        job 95171738870  success  12 steps  pinned container; 130 passed, 4 skipped; failure upload skipped
Contracts      job 95171738459  success   9 steps  Foundry format/build; 3/3 tests
Infrastructure job 95171738473  success  17 steps  cold start; repeat migrate/seed; 8/8 infrastructure; 43/43 PostgreSQL
Security       job 95171738517  success  10 steps  Gitleaks action and dependency audit passed
```

The first real attempt completed Browser successfully, then exposed root-owned checkout files left by the pinned Browser container on this sequential self-hosted runner. The runner worktree ownership was restored and only the five failed pre-test Jobs were rerun; attempt 2 then completed the aggregate run successfully. Earlier `steps: []` allocation failures remain non-evidence.

The GitHub Security action scanned its incoming push range. The independent Gitleaks command above scanned full history; the two scopes are intentionally not represented as equivalent.
