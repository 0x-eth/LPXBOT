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

The final gate run was repeated after the checksum-covered P02-05 tree was complete:

```text
pnpm format:check: passed
pnpm lint: 14/14 tasks passed
pnpm typecheck: 21/21 tasks passed
pnpm test: 46/46 Vitest files and 281/281 tests passed; 39/39 governance tests passed
pnpm build: 14/14 tasks passed
pnpm check:all: passed
pnpm test:e2e: 118 passed, 4 skipped (122 total)
pnpm test:infra: 8/8 tests passed
pnpm test:postgres: 11/11 files and 39/39 tests passed
pnpm test:contracts: 3/3 tests passed
pnpm audit:dependencies: no known vulnerabilities
Gitleaks 8.30.1 full-history scan: 510 commits, 20.05 MB, no leaks
Gitleaks 8.24.3 compatibility scan: 510 commits, 20.05 MB, no leaks
```

## GitHub Actions runner provenance

GitHub-hosted allocation attempts made before the temporary runner was registered ended with `steps: []` because the account could not allocate hosted minutes. No repository command ran in those attempts, so they are allocation history only and are not remote execution evidence. Self-hosted run `31937474147` executed real steps but failed Security and is also not accepted.

The accepted GitHub Actions evidence is push run [`31938091566`](https://github.com/0x-eth/LPXBOT/actions/runs/31938091566) for commit `4b9e7b01383ee1d7197f4c482eab82acf20ce745`, completed `2026-08-16T09:16:38Z`. GitHub dispatched every Job to repository runner ID `22`, name `p02-05-colima-arm64`, labels `self-hosted`, `Linux`, `ARM64`, `p02-05-arm64`, runner version `2.336.0`. The runner was a temporary repo-scoped process inside Colima `0.10.3`, Ubuntu `24.04.4 LTS` arm64, Linux `6.8.0-117-generic`, 4 CPUs, 8 GB RAM, Docker `29.5.2`, hosted by macOS `15.7.4` arm64. It is explicitly self-hosted GitHub Actions provenance, not GitHub-hosted provenance and not a local-equivalent substitution.

```text
Contracts      job 95143075205  success  9 steps   3/3 Foundry tests
Infrastructure job 95143075207  success 17 steps   migrations/seed repeated; 8/8 infrastructure and 39/39 PostgreSQL tests
Governance     job 95143075217  success 15 steps   baseline, 196 IDs, docs, manifests and reference checks
Browser        job 95143075226  success 12 steps   118 passed, 4 skipped; failure-only upload step skipped by condition
Security       job 95143075246  success 10 steps   Gitleaks passed; dependency audit found no known vulnerabilities
Quality        job 95143075250  success 13 steps   format, lint 14/14, typecheck 21/21, test and build
```

The Security action checked the incoming push commit according to its push-event range. The independent Gitleaks 8.30.1 and action-compatible 8.24.3 commands above both scanned the full 510-commit repository history; this distinction is retained instead of representing a local command as a GitHub-hosted scan.

## Frozen boundaries

```text
requested baseline: de0a846b137777f710f53f25f47f276b43d43b7c
stable implementation anchor: 4b9e7b01383ee1d7197f4c482eab82acf20ce745
P02-01 tree: ab14275c2df97d44f86c2970d441495dd94fbe82
P02-02 tree: a5cd9382933646f73fba0c5fc8fe2297fabe0354
P02-03 tree: 82304becc026450cfc0f9c032f623ed965cd8817
P02-04 tree: bb0de91719c10010fbfac896fdb597aee8d7caa4
protected files: 100
```

The protected P02-01 through P02-04 aggregate hash list matches `/tmp/p02-01-04-before.sha256` byte-for-byte. Both required gaps remain unresolved, and the work-item conclusion is `accepted-with-gaps`.
