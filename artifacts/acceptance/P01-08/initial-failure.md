# P01-08 Initial Failure

- Baseline commit: `b1510673efe4ec474ecbd7e1df8e3eb903176079`
- Command: `node --test tests/governance/p01-completion.test.mjs`
- Result: expected failure (`2` passed, `2` failed)
- Classification: acceptance-package gap; no product regression was identified by this run.

```text
TAP version 13
# Subtest: P01-02 through P01-07 accepted manifests cover every P01 feature exactly once
ok 1 - P01-02 through P01-07 accepted manifests cover every P01 feature exactly once
# Subtest: each P01 implementation manifest meets its feature traceability minimums
ok 2 - each P01 implementation manifest meets its feature traceability minimums
# Subtest: P01-01 remains reference-only and P01-08 claims no implementation features
not ok 3 - P01-01 remains reference-only and P01-08 claims no implementation features
  error: P01-08 was absent from the acceptance directory inventory
# Subtest: P01 feature coverage records inspectable implementation, tests, evidence, and status
not ok 4 - P01 feature coverage records inspectable implementation, tests, evidence, and status
  error: ENOENT: artifacts/acceptance/P01-08/feature-coverage.json
1..4
# tests 4
# pass 2
# fail 2
```

## UI route-state red run

- Command: `LPBOT_PLAYWRIGHT_PORT=43178 pnpm exec playwright test tests/e2e/p01-completion.spec.ts --project=chromium-desktop --workers=1`
- Result: expected failure (`3` failed)
- Findings:
  - `/tasks/running?fixture=route-loading` rendered the existing empty fixture because the per-route state catalog did not exist.
  - Dark/system-dark route rendering produced one serious axe `color-contrast` violation: `.eyebrow` used `#60686c` against `#151719` (`3.16:1`).
  - The settings empty-state matrix could not be isolated from the long settings form, so the state-specific mobile overlap assertion failed at 320px.

```text
Running 3 tests using 1 worker
not ok - P01 route-state matrix covers loading, empty, error and forbidden
  Expected data-fixture-state="loading"; received "empty"
not ok - P01 route matrix covers light, dark and system themes on both viewports
  axe color-contrast serious: 3.16, expected 4.5:1
not ok - P01 route matrix stays non-overlapping at all required widths
  /settings at 320px: state-specific mobile overlap assertion failed
3 failed
```

## PostgreSQL migration-cycle red run

- Command: `pnpm test:postgres`
- Result: expected failure in the new full-cycle test (`19` passed, `1` failed).
- Finding: TimescaleDB rejects dropping and recreating its extension in the same PostgreSQL backend session (`extension "timescaledb" has already been loaded with another version`).
- Resolution boundary: keep migration SQL unchanged and reconnect between reverse-down and the subsequent up cycle, matching separate dbmate command processes.

## Full Playwright budget red run

- Command: `LPBOT_PLAYWRIGHT_PORT=43179 pnpm test:e2e`
- Result: expected test-harness failure (`74` passed, `4` skipped, `4` failed).
- Finding: the new route-state and theme matrices each perform 27-36 navigation plus axe combinations per browser project and exceeded Playwright's default 30-second per-test timeout during the full parallel suite. Focused assertions had already passed, and the failures contained no visual, accessibility or overlap assertion mismatch.
- Resolution boundary: assign each finite combination matrix the same explicit 90-second budget already used by the five-width matrix; do not relax assertions, screenshot thresholds or masks.

## PostgreSQL cleanup red run

- Command: reset local volumes, run migration twice, seed twice, then `pnpm test:infra && pnpm test:postgres`.
- Result: empty-database migration/seed and 8 infra tests passed; all 8 PostgreSQL files and 20 assertions passed, but Vitest rejected the run for one unhandled `57P01` connection termination.
- Finding: `postgres-chain-access-store.integration.ts` closed its fixture pool and then used `DROP DATABASE ... WITH (FORCE)` during normal teardown, allowing PostgreSQL to terminate a client that was already ending.
- Resolution boundary: retain `WITH (FORCE)` only in `beforeAll` to clean residue from interrupted runs; after an orderly `fixturePool.end()`, use plain `DROP DATABASE` so teardown proves that no fixture connection remains.

## Historical visual artifact write

- Command: full `pnpm test:e2e` re-execution.
- Result: the strict P01-06 `toHaveScreenshot` assertions passed, but the test then unconditionally rewrote tracked `*-actual.png` evidence and changed the frozen P01-06 Git tree.
- Resolution boundary: keep the existing masks, `maxDiffPixels: 60` threshold and snapshot assertions unchanged; require `LPBOT_CAPTURE_P01_06=1` only for the separate historical evidence-write step. Restore the affected PNG from the requested start commit and keep new captures under P01-08.

## Acceptance checker red run

- Command: `node --test --test-name-pattern='accepts only the P01-08' tests/governance/governance-checkers.test.mjs`
- Result: expected failure; `P01-08` was rejected solely because its required empty `featureIds` array did not yet have a checker exception.
- Boundary: the exception is exact to `P01-08`; the same empty array remains rejected for other P01 work items.
