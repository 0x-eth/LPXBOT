# E-API

- `GET /api/pools/by-token/:address` is an authenticated, no-store, read-only route. It accepts exactly `chain=bsc`, `dex`, `limit`, and `sort`; the path parameter must be a 20-byte EVM address.
- `dex` uses the same canonical protocol parser as the snapshot and SSE surfaces. Only `pcsv3`, `univ3`, `pcsv4`, and `univ4` are accepted, duplicates are removed, and the resulting set is deterministic.
- `limit` defaults to 100 and accepts only integers from 1 through 100. `sort` defaults to `fees` and accepts only `fees` or `volume`. Unknown query keys, non-BSC chains, malformed addresses, invalid protocols, invalid limits, and invalid sorts return `400 MARKET_TOKEN_QUERY_INVALID` in the standard safe error envelope.
- Results originate in `market_pool_catalog` and left-join the current canonical 5-minute and 60-minute snapshots. Fee ordering is `fees5m`, `fees1h`, `poolKey`; volume ordering is `volume5m`, `volume1h`, `poolKey`. Both metric levels use descending numeric order with nulls last, and `LIMIT` is applied after ordering.
- An unknown Token returns `200` with an empty array. The response includes stable `poolKey`, V3 `poolAddress` or V4 `poolId`, canonical token addresses, `feePips`, `tickSpacing`, `hooks`, and separate 5-minute/1-hour metrics.
- The route uses the existing authenticated-account policy and a configurable per-session read limit (default 60/minute). Anonymous access, disabled account policy, rate limiting, provider absence, and provider errors retain the established error-envelope boundary without leaking SQL or upstream detail.

Focused API and PostgreSQL tests cover parameter normalization, exact query allowlisting, DEX filtering, empty results, rate limiting, authorization, 5m/60m merging, null placement, stable ties, and post-sort limiting.
