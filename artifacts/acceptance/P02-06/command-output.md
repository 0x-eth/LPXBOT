# P02-06 command output

Verification ran on `2026-08-16` with Node `22.23.1`, pnpm `11.17.0`, macOS arm64, and the repository PostgreSQL/Docker fixture. No `BSC_RPC_URL`, external RPC, production secret, signature, broadcast, funds operation, metadata fetch, price fetch, creator lookup, or new chain sample was used.

## Test-first record

See `initial-failure.md`. Catalog, identity contract, by-token API, search reducer, grouping, column preference, PostgreSQL recovery, and Playwright coverage all produced red states before the corresponding implementation.

## Focused verification

```text
P02-06 focused unit/API/SSE/preferences Vitest suites: passed
PostgreSQL market indexer suite: 13/13 passed
PostgreSQL preferences suite: 3/3 passed
Full Playwright suite: 124 passed, 4 skipped
P02-01 through P02-05 acceptance trees: byte-identical to the pre-work hash list
```

## Final local gates

Final counts and security scan results are appended after the post-evidence gate run.

## GitHub Actions runner provenance

The accepted six-job run, nonempty step counts, runner labels/version/OS, and commit are appended after GitHub Actions completes. Runs reporting `steps: []` are allocation history only and are not accepted as execution evidence.

## Frozen boundaries

```text
requested baseline: 407ba1b8c794c29aac7e7a46545476efbda52247
P02-01 through P02-05: protected and byte-identical to /tmp/p02-01-05.before.sha256
```

`POOL-05/06/07`, `POOL-11..15`, and `STATS-01/02` remain planned. `POOL-15` creator attribution, `GAP-FINALITY-DEPTH`, `GAP-FLOW-USD-VALUATION`, and the existing USD/formula gaps remain unresolved. The work-item conclusion is `accepted-with-gaps`.
