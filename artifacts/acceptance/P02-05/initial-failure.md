# P02-05 initial failures

Tests preceded each implementation slice. The recorded red states were:

- FLOW projection tests initially lacked `buildLiquidityFlowProjection` and failed to compile until summary/address projection was implemented.
- Address contract/API/client/PostgreSQL tests initially referenced missing contracts, routes, store, and tables.
- The first P02-05 browser run reported two axe failures: invalid overridden `dl` semantics and non-focusable horizontal scroll regions. The final focused run passed 6/6.
- New stale-refresh and oversized-body tests failed 2/13: the optimistic row was replaced by the server's old value and oversized PUT returned 500. The reducer merge and audited 413 boundary made the same tests pass 13/13.
- The first complete PostgreSQL run failed 2/39: the new audit trigger depended on an older migration function, and an append-only audit assertion used a non-repeatable absolute count. A migration-local trigger function and baseline-relative assertion made the clean reverse-down/up run pass 39/39.
- The governance red run failed 3/8: the global matrix still reported 171 planned, FLOW-03/04/05 were absent from the implemented set, and `P02-05/manifest.json` did not exist.
- Dedicated P02-05 desktop/mobile screenshot assertions first failed because their baselines did not exist; the inspected Darwin and pinned-Linux baselines are now checked in.
