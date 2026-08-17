# P02-13 Initial Failure

The behavioral tests were written and executed before the corresponding implementation.

## Contract, API, SSE and client red run

Command:

```text
pnpm exec vitest run tests/task-status-stats.test.ts tests/stats-sse-api.test.ts tests/shell-stats-client.test.ts
```

Result: exit code 1. Across 25 tests, 17 passed and 8 failed. The missing behavior was observable as: no authoritative canonicalizer/derived total, scope-shaped provider calls returning HTTP 500, unknown Telegram IDs opening HTTP 200 SSE, provider failures returning 500 instead of retryable 503, no target audit/snapshot, and no local heartbeat watchdog timeout.

## PostgreSQL red run

Command:

```text
DATABASE_URL=<local fixture> pnpm exec vitest run --config vitest.postgres.config.ts tests/integration/postgres-shell-stats.integration.ts
```

Result: exit code 1. All 5 initial integration tests failed because `task_status_stats_conflicts` and the rest of the projection schema did not exist.

## Governance red run

Command:

```text
node --test tests/governance/p02-completion.test.mjs
```

Result: exit code 1 with 28 passed and 5 failed. STATS-01 was still planned and the P02-13 manifest, contract, Golden, prior inventory, and checksum inventory did not exist.

## Migration tracer correction

The first new migration attempt rolled back with `INSERT has more target columns than expressions` in the global stream-head seed. The missing explicit stopped-count zero was added; the next first migration succeeded and the immediately repeated migration was a no-op.
