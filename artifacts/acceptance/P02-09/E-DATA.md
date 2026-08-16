# E-DATA

- The sole source is the canonical `top-fees:56:5` snapshot obtained through `MarketPoolsProvider.getTopFees`. P02-09 adds no market snapshot SQL and no RPC access.
- Eligibility requires BSC chain identity, one of the four frozen protocols, valid V3 address or V4 pool ID identity, both token addresses, and a finite positive Decimal `feesUsd` value.
- Selection compares unrounded Decimal fees descending, then compares `poolKey` in byte order. It deduplicates by `poolKey` before applying the requested limit.
- Label score, Hook, active TVL, creator attribution, and unknown prices are excluded from weighting. Unknown symbols remain null.
- `selectionHash` is SHA-256 over `JSON.stringify` of the ordered wire rows only. Observation time, source generation time, and canonical revision are excluded.
- `golden/input.json` includes tied fees, a lower-value duplicate, a valid V4 row, null and zero fees, a Hook, and an invalid identity. `golden/output.json` freezes the three ordered wire rows, hash, and cursor. The production selector reproduces it in Vitest.
- No storage schema or migration is added. P02-01 through P02-08 remain covered by the 162-file pre-work SHA-256 inventory.
