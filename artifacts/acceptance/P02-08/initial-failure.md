# P02-08 initial failure

Date: 2026-08-16

The label contract tests were written before production implementation.

## Focused unit/API/SSE/preferences failure

Command:

```text
pnpm exec vitest run tests/pool-labels.test.ts tests/pool-label-stream.test.ts tests/pool-label-preferences.test.ts
```

Result: expected failure, 3 files failed and 18 tests failed. The failures identified the absent versioned rule engine, absent strict market-stream parser, missing diff snapshot context propagation, and the still-v4 preference schema.

## Focused Playwright failure

Command:

```text
pnpm exec playwright test tests/e2e/p02-08-pool-labels.spec.ts --project=chromium-desktop
```

Result: expected failure, 2 tests failed because no pool-label trigger or expanded detail layer existed.

No production implementation was changed before these failures were captured.
