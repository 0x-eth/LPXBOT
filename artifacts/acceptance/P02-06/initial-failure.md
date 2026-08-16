# P02-06 initial failures

Tests preceded each implementation slice. The recorded red states were:

- Catalog integration tests first failed because `market_pool_catalog` and its migration did not exist; V3/V4 identity, replay, duplicate, removal, and replacement-branch expectations had no storage boundary.
- Market contract tests first failed on missing `poolKey`, token0/token1 addresses, fee pips, tick spacing, and hooks in snapshot/diff rows.
- By-token API tests first failed because the route and provider method did not exist. Subsequent red assertions covered BSC-only validation, DEX canonicalization, 1..100 limits, 5m/60m merge, null-last stable sorting, empty results, authentication, and rate limiting.
- Search reducer and browser tests first failed because mode/value URL state, request generations, cancellation, V4 pool-ID matching, and the six requested UI states were absent.
- Grouping tests first failed because the ranking rendered individual rows only. Canonical Token grouping, frozen quote-token disambiguation, `+N`, expansion, and SSE reconciliation were then implemented to satisfy them.
- Column tests first failed because preferences schema v2 had no pool-column field and the table had no column editor. Locked edges, visibility, pointer/keyboard reorder, reset, migration, conflict, rollback, and cross-device tests drove schema v3 and the UI.
- Dedicated P02-06 desktop/mobile screenshots initially had no checked capture files. The final runs produced the inspected PNGs and passed axe plus root-overflow assertions.
