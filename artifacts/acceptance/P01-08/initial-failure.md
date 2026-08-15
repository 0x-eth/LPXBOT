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
