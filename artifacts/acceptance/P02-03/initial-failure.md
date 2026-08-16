# P02-03 initial failure

- Captured at: `2026-08-16T09:33:38+08:00`
- Baseline: `e640d97ca9e9fe99683f919d454ea6bf7b3a607b`
- Command: `pnpm exec vitest run tests/protocol-deployment-registry.test.ts tests/production-chain-decoder.test.ts tests/viem-bsc-log-source.test.ts`
- Result: failed as expected before implementation (`3` test files failed; `4` discovered tests failed).

Key failures:

```text
Cannot find module '../packages/chain-adapters/src/index.js'
TypeError: Cannot read properties of undefined (reading 'map')
TypeError: BSC_PROTOCOL_DEPLOYMENTS is not iterable
```

Frozen acceptance tree objects at the start of work:

```text
P02-01 ab14275c2df97d44f86c2970d441495dd94fbe82
P02-02 a5cd9382933646f73fba0c5fc8fe2297fabe0354
```

Follow-up red checks found during implementation review:

```text
2026-08-16T10:45:14+08:00
production-indexer-startup: expected marketDecoderComplete false, received true
Cause: four versions of univ3 were incorrectly counted as four-protocol coverage.

2026-08-16T10:47:30+08:00
viem-bsc-log-source: expected one same-block header request, received two
Cause: concurrent deliveries did not share a bounded block-header cache.
```
