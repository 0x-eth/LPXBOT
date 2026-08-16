# P02-03 command output

Local verification completed on `2026-08-16` without `BSC_RPC_URL`. See `initial-failure.md` for the pre-implementation red test.

## Focused offline acceptance

```text
pnpm exec vitest run tests/protocol-deployment-registry.test.ts tests/production-chain-decoder.test.ts tests/production-indexer-startup.test.ts tests/viem-bsc-log-source.test.ts tests/p02-03-acceptance.test.ts tests/p02-03-capture-policy.test.ts
Result: passed (6 files, 50 tests)
```

The fixed official ABI/deployment URLs were fetched read-only at their recorded revisions and piped directly to SHA-256. All 10 source files and both V3 concatenated interface hashes matched `source-manifest.json`.

## Six CI job equivalents

```text
Quality:        format:check, lint, typecheck, test, build passed
Governance:     check:all passed; 13 acceptance manifests valid
Browser:        test:e2e passed (92 passed, 4 viewport skips); test:pwa passed (4 passed)
Contracts:      forge fmt --check/build/test passed (3 tests)
Infrastructure: test:infra passed (8 tests); test:postgres passed (9 files, 30 tests)
Security:       Gitleaks full-history passed; dependency audit found no vulnerabilities
```

The PostgreSQL run includes the complete migration `up -> reverse down -> up` cycle, migration-specific down/up checks, repeatable seed, cursor restart and reorg recovery. The offline decoder golden and mock RPC suites do not access public RPC.

## Frozen evidence

```text
baseline commit: e640d97ca9e9fe99683f919d454ea6bf7b3a607b
P02-01 tree:    ab14275c2df97d44f86c2970d441495dd94fbe82
P02-02 tree:    a5cd9382933646f73fba0c5fc8fe2297fabe0354
P02-01 gaps:    bb043d63634c1e0944bd62b7864e3353dfbfe92e17efbfc176175c6ba8a4f505
```

`GAP-FINALITY-DEPTH` remains unresolved, so the acceptance status is `accepted-with-gaps`.
