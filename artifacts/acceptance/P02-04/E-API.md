# E-API

- `GET /api/pools/top-fees/:minutes` and its `/stream` sibling accept the same `dex` collection semantics. The collection is split, validated, deduplicated, and ordered as `pcsv3,univ3,pcsv4,univ4`; invalid or empty values return HTTP 400.
- Snapshot rows, SSE snapshot rows, and SSE diff upserts are filtered by the identical canonical protocol set. The same set produces one stable stream key, and valid combinations may return an empty result.
- `GET /api/liquidity-adds/stream` remains public and read-only. Its only query parameters are `since`, `pool`, `token`, `user`, and `nft_id`; unknown keys, unsafe timestamps, malformed addresses, malformed pool IDs, and malformed NFT IDs return HTTP 400.
- The market and flow contracts fix `chainId`/`chain_id` to BSC 56. No multi-chain behavior is claimed.
- Focused API tests are `tests/market-pools-api.test.ts` and `tests/liquidity-flow-api.test.ts`.
