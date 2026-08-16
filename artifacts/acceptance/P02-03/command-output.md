# P02-03 command output

Local verification completed on `2026-08-16` with Node `22.23.1` and pnpm `11.17.0`, without `BSC_RPC_URL`. See `initial-failure.md` for the pre-implementation red test.

## Focused offline acceptance

```text
pnpm exec vitest run tests/protocol-deployment-registry.test.ts tests/production-chain-decoder.test.ts tests/production-indexer-startup.test.ts tests/viem-bsc-log-source.test.ts tests/p02-03-acceptance.test.ts tests/p02-03-capture-policy.test.ts
Result: passed (6 files, 54 tests)
```

The fixed official ABI/deployment URLs were fetched read-only at their recorded revisions and piped directly to SHA-256. All 10 source files and both V3 concatenated interface hashes matched `source-manifest.json`.

## Local six CI job equivalents

```text
Quality:        format:check, lint, typecheck and build passed; Vitest 39 files/231 tests passed; governance tests 36/36 passed
Governance:     check:all passed; 13 acceptance manifests valid
Browser:        test:e2e passed (92 passed, 4 viewport skips); test:pwa passed (4 passed)
Contracts:      forge fmt --check/build/test passed (3 tests)
Infrastructure: test:infra passed (8 tests); test:postgres passed (9 files, 30 tests)
Security:       Gitleaks full-history passed (429 commits, 19.73 MB); dependency audit found no vulnerabilities
```

These commands are local equivalents of the six CI Jobs. They remain useful supporting evidence, but they are distinct from Hosted CI execution.

## Hosted CI execution evidence

- Run: `31923619152`
- Attempt: `2`
- Head SHA: `52aef88f99b3701ee5218a4ca1d19b051d211639`
- Run conclusion: `success`
- Completed: `2026-08-16T03:23:59.000Z`

`gh run view 31923619152 --attempt 2 --json attempt,headSha,conclusion,createdAt,startedAt,updatedAt,jobs,url,workflowName` returned a non-empty `steps` array and `conclusion: success` for every Job:

| Job | Job ID | Started | Completed | Conclusion | Successful execution step |
| --- | ---: | --- | --- | --- | --- |
| Quality | `95107894904` | `2026-08-16T03:14:16Z` | `2026-08-16T03:15:47Z` | `success` | `Test` |
| Governance | `95107894873` | `2026-08-16T03:14:16Z` | `2026-08-16T03:14:37Z` | `success` | `Verify acceptance manifests` |
| Browser | `95107894879` | `2026-08-16T03:14:16Z` | `2026-08-16T03:23:58Z` | `success` | `Run browser tests` |
| Contracts | `95107894888` | `2026-08-16T03:14:16Z` | `2026-08-16T03:14:26Z` | `success` | `Run contract tests` |
| Infrastructure | `95107894917` | `2026-08-16T03:14:17Z` | `2026-08-16T03:15:31Z` | `success` | `Run PostgreSQL session integration tests` |
| Security | `95107894900` | `2026-08-16T03:14:17Z` | `2026-08-16T03:14:36Z` | `success` | `Audit dependencies` |

The conditionally skipped Browser report-upload step runs only on failure; the Browser Job and its test step both concluded `success`. Attempt 2 is the remote execution evidence for the stable implementation commit.

### Attempt 1 allocation history

- Run: `31923619152`
- Attempt: `1`
- Head SHA: `52aef88f99b3701ee5218a4ca1d19b051d211639`
- Run conclusion: `failure`

`gh run view 31923619152 --attempt 1` reports all six Jobs with `steps: []`. GitHub assigned no runner and attached the same annotation to each Job:

```text
The job was not started because recent account payments have failed or your spending limit needs to be increased. Please check the 'Billing & plans' section in your settings
```

This was a runner allocation/billing failure, not a test failure, and attempt 1 is not remote execution evidence. Earlier run `31923400642` for head `328a5403092c504d50c4f5d6d67bd140514c29e8` had the same pre-run allocation failure and remains historical context only.

The PostgreSQL run includes the complete migration `up -> reverse down -> up` cycle, migration-specific down/up checks, repeatable seed, cursor restart and reorg recovery. The offline decoder golden and mock RPC suites do not access public RPC.

## Frozen evidence

```text
baseline commit: e640d97ca9e9fe99683f919d454ea6bf7b3a607b
P02-01 tree:    ab14275c2df97d44f86c2970d441495dd94fbe82
P02-02 tree:    a5cd9382933646f73fba0c5fc8fe2297fabe0354
P02-01 gaps:    bb043d63634c1e0944bd62b7864e3353dfbfe92e17efbfc176175c6ba8a4f505
```

`GAP-FINALITY-DEPTH` remains unresolved, so the acceptance status is `accepted-with-gaps`.
