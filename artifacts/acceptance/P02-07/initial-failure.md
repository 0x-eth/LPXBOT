# P02-07 initial failures

Tests preceded each implementation slice. The recorded red states were:

- The initial focused Vitest run could not import `pool-filter-state` or `pool-comparison-state` because neither module existed. Thirteen remaining assertions failed on the missing Decimal Fee/TVL function, HALF_EVEN formatter, two new columns, preference schema v4 defaults, and v3-to-v4 migration.
- Fee/TVL boundary assertions were red for missing Fees, missing TVL, zero TVL, negative TVL, zero Fees, arbitrary-precision Decimal inputs, and the two HALF_EVEN tie cases.
- Filter assertions were introduced for every requested range, null exclusion, inclusive Decimal bounds, combined AND semantics, stable null-last sorting, known-symbol Han detection, duplicate URL keys, invalid URL values, round-trip restoration, and deterministic reset.
- Comparison assertions were introduced for stable `poolKey` selection, the two-pool ready boundary, the three-pool limit, canonical `feePips`, unresolved best-value exclusion, one-snapshot binding, SSE upsert refresh, and tombstone removal.
- Preference assertions were red while schema version 3 still exposed eight columns. They required schema v4, preservation of the legacy order and every unrelated preference, safe removal of unknown/duplicate columns, and locked `pool`/`actions` edges.
- The first Playwright tracer failed because the pool table had no `Fee/TVL` header. The comparison and advanced-filter controls were also absent at that point.
- The P02 governance test was then updated first and failed on the old 13/10 counts plus missing P02-07 manifest and checksum inventory.

The raw initial command outputs were retained during development at `/tmp/p02-07-initial-unit-failure.txt` and `/tmp/p02-07-initial-ui-failure.txt`; this repository artifact records the durable failure facts without machine-specific trace archives.
