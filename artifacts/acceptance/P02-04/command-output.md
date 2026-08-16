# P02-04 command output

Local verification runs on `2026-08-16` with Node 22.23.1 and pnpm 11.17.0. The tests use the frozen P02-03 Golden files and local PostgreSQL only; `BSC_RPC_URL` is not used.

## Test-first record

See `initial-failure.md`. Contract, projection, PostgreSQL recovery, API/SSE/client, DEX filter, and UI tests were committed before their corresponding implementations. The final governance red test failed 1 of 2 subtests until the P02-04 status/evidence update was added.

## Focused verification

```text
Liquidity contract/projection/client/API and POOL-03 suites: passed
PostgreSQL integration: 10 files, 36 tests passed
Playwright pools/flow on Darwin: 34 tests passed
Playwright pools/flow in mcr.microsoft.com/playwright:v1.62.1-noble: 34 tests passed
```

## Final local gates

Final command counts and Hosted CI execution are recorded after the acceptance tree is frozen.
