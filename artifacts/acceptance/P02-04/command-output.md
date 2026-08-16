# P02-04 command output

Local verification completed on `2026-08-16` with Node `22.23.1` and pnpm `11.17.0`. The tests use the frozen P02-03 Golden files and local PostgreSQL only; `BSC_RPC_URL` is not used.

## Test-first record

See `initial-failure.md`. Contract, projection, PostgreSQL recovery, API/SSE/client, DEX filter, and UI tests were committed before their corresponding implementations. The final governance red test failed 1 of 2 subtests until the P02-04 status/evidence update was added.

## Focused verification

```text
Liquidity contract/projection/client/API and POOL-03 suites: 6 files, 41 tests passed
PostgreSQL integration: 10 files, 36 tests passed
Playwright pools/flow on Darwin: 34 tests passed
Playwright pools/flow in mcr.microsoft.com/playwright:v1.62.1-noble: 34 tests passed
Full Playwright matrix: 112 passed, 4 expected viewport skips
```

The first final `test:infra` run exposed a stale exact table-list assertion after the flow migration was applied. The assertion was updated to include `liquidity_flow_events` and `liquidity_flow_outbox`; the complete infrastructure suite then passed 8/8.

## Local six CI job equivalents

```text
Quality:        format:check, lint, typecheck and build passed; Vitest 43 files/265 tests passed; governance tests 37/37 passed
Governance:     check:all passed; 14 acceptance manifests valid
Browser:        test:e2e passed (112 passed, 4 expected viewport skips)
Contracts:      forge fmt --check/build/test passed (3 tests)
Infrastructure: test:infra passed (8 tests); test:postgres passed (10 files, 36 tests)
Security:       Gitleaks full-history passed (476 commits, 19.90 MB); dependency audit found no known vulnerabilities
```

These are local equivalents of the six Hosted CI Jobs and are supporting evidence rather than a substitute for remote execution.

## Hosted CI execution

The final Hosted CI run is selected only after this checksum-covered acceptance tree is frozen. The final HEAD must have successful Quality, Governance, Browser, Contracts, Infrastructure, and Security Jobs, each with a non-empty `steps` array; that immutable run is carried by the final commit's GitHub Checks to avoid a self-referential evidence commit.

## Frozen inputs

```text
Baseline: 4dbefe1fe3fed9933988851ce07c633d8aca1494
P02-01/P02-02/P02-03 protected aggregate: f94cf50321904efa60e7306dd443ae2b6dd6dbddfc004b3db81760c8b5168918
Implementation anchor: 9671506182bb9a7b827d0450066d7f2577278e0a
```

All 85 files under P02-01, P02-02, and P02-03 remained byte-identical. `GAP-FINALITY-DEPTH` remains unresolved, no event is marked finalized, and the acceptance conclusion remains `accepted-with-gaps`.
