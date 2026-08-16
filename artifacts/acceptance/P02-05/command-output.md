# P02-05 command output

Local verification ran on `2026-08-16` with Node `22.23.1`, pnpm `11.17.0`, macOS `15.7.4` arm64, Docker client `29.7.2`, and Docker server `29.5.2`. No `BSC_RPC_URL`, external RPC, production secret, signature, broadcast, or funds operation was used.

## Test-first record

See `initial-failure.md`. Governance, reducer refresh, request-size/audit, migration independence, PostgreSQL repeatability, axe, and visual-baseline tests all produced red output before their corresponding fixes.

## Focused verification

```text
FLOW projection/SSE regression plus remark contract/API/client: 6 files, 37 tests passed
Remark API/client follow-up: 2 files, 13 tests passed
PostgreSQL integration and full migration cycle: 11 files, 39 tests passed
P02-05 Playwright on Darwin: 6 tests passed
Pools/flow Playwright regression on Darwin: 34 tests passed
Pinned Playwright Linux visual selection: 6 tests passed
Clean db:migrate + repeat db:migrate: passed
Deterministic db:seed + repeat db:seed: passed
```

The Linux visual command used `mcr.microsoft.com/playwright:v1.62.1-noble@sha256:dcc5531e97840b9b5e794f2814476b21571c5124a3fca2267d73041f56e7580e`, installed the frozen lockfile in a clean clone, built `@lpbot/web` dependencies, and ran desktop/mobile visual tests. This is local supporting evidence, not Hosted CI provenance.

## Final local gates

The final gate run records `format:check`, `lint`, `typecheck`, `test`, `build`, `check:all`, full Playwright, infrastructure/PostgreSQL, Gitleaks, dependency audit, and contract results after the checksum-covered tree is complete.

## Hosted CI provenance

Runs `31935869553` attempts 1 and 2 for implementation anchor `fc3aeb78f25f66b4aa54a30db83876215b6701c2` both ended with all six Jobs reporting `steps: []`; no runner executed repository commands. They are allocation history only and are not accepted as remote execution evidence.

The accepted Hosted CI run is added only after Quality, Governance, Browser, Contracts, Infrastructure, and Security each report `conclusion: success` with non-empty steps. The final HEAD is then checked independently to avoid treating local equivalents as a remote run.

## Frozen boundaries

```text
requested baseline: de0a846b137777f710f53f25f47f276b43d43b7c
stable implementation anchor: fc3aeb78f25f66b4aa54a30db83876215b6701c2
P02-01 tree: ab14275c2df97d44f86c2970d441495dd94fbe82
P02-02 tree: a5cd9382933646f73fba0c5fc8fe2297fabe0354
P02-03 tree: 82304becc026450cfc0f9c032f623ed965cd8817
P02-04 tree: bb0de91719c10010fbfac896fdb597aee8d7caa4
protected files: 100
```

The protected P02-01 through P02-04 aggregate hash list matches `/tmp/p02-01-04-before.sha256` byte-for-byte. Both required gaps remain unresolved, and the work-item conclusion is `accepted-with-gaps`.
