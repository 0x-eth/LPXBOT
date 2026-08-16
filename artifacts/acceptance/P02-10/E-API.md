# E-API

- `GET /api/market/candles` accepts exactly `token`, optional `poolKey`, `bar`, `limit`, and `chainId=56`. The UI always sends `poolKey`; token-only lookup is accepted only when the provider resolves exactly one pool.
- Ambiguous token lookup returns a safe `AMBIGUOUS_POOL` envelope instead of selecting by fees, volume, or popularity. A token outside the selected pool also fails explicitly.
- `GET /api/pools/liquidity/:poolAddressOrPoolId` accepts exactly `range`, `chain=bsc`, `dex`, `tickSpacing`, and an all-or-none `decimals0`/`decimals1` pair. Range is limited to 5 through 50.
- Both endpoints are BSC-only authenticated GET routes with a credential-keyed read rate limit. They introduce no mutation, signer, transaction builder, broadcast, or funds operation.
- Unknown pools return 404. A missing provider returns retryable 503 `MARKET_CHARTS_UNAVAILABLE`. Invalid or unsupported parameters use the shared safe error envelope and do not expose provider or database details.
- A known pool with no history succeeds with `candles=[]`. Missing current tick succeeds with `currentTick=null` and `ticks=[]`; missing decimals retain null tick prices.
- Successful responses expose `canonicalRevision`, `version`, `asOf`, and `source=canonical-events`, plus explicit price and volume units for Candles.
- Focused API coverage exercises normalization, all bars, limits, BSC rejection, ambiguous resolution, null handling, authentication, rate limiting, 404, 503, and error-envelope safety.
