# E-API

- `MarketPoolRow.feeTvl` is produced from current-window `feesUsd / tvlUsd`. The calculation is not annualized and does not pass through JavaScript `number`.
- Missing Fees, missing TVL, and TVL less than or equal to zero produce null. Zero Fees with positive TVL produces the exact Decimal string `0`.
- `activeTvlUsd` and `feeActiveTvl` remain contractually null. No API, filter, or UI path derives them or substitutes numeric zero.
- User preferences advance from schema v3 to v4 solely to add `feeTvl` and `feeActiveTvl` column keys. The API continues to validate the complete allowlisted preference shape and revision boundary.
- Snapshot and diff payloads carry the same canonical metric fields consumed by filtering and comparison; P02-07 adds no separate metric endpoint and no alternate data version.

Focused API/contract coverage passed inside the 11-file, 62-test P02-07 run, including `market-pools-api`, `pools-by-token-api`, and `user-preferences-api`.
