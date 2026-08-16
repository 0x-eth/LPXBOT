# E-UI

- Advanced filters appear after DEX and search controls and before grouping and comparison candidates. They cover V3/V4, Volume, Fees, Fee/TVL, Fee/aTVL, TVL, aTVL, Txs, Hook, and known-symbol Han exclusion.
- Filter state is URL-serializable, refresh-restorable, validated, duplicate-key resistant, and deterministically reset without deleting unrelated search parameters.
- The table exposes Fee/TVL and Fee/aTVL columns. Fee/aTVL currently displays `不可用`; column settings retain pointer and keyboard ordering with fixed visible `pool` and `actions` edges.
- Comparison uses session-only stable pool keys, becomes ready at two pools, accepts at most three, exposes the limit state, and clears without writing cross-device preferences.
- Loading, empty, invalid, no-results, null/unavailable, one-selected, ready, and limit-reached states are covered by unit or Playwright assertions.
- The focused P02-07 Playwright run passed 6/6 tests across desktop and mobile. The full browser regression passed 130 tests with 4 intentional project skips.
