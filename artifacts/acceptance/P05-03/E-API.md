# E-API

P05-03 adds four authenticated, observation-only HTTP surfaces:

| Method | Route | Boundary |
|---|---|---|
| `POST` | `/api/swap/quote` | Accepts only `walletId`, `chainId`, `platformId`, `tokenIn`, `tokenOut`, `amountInBaseUnit`, and `slippageBps`. |
| `GET` | `/api/pricing-positions` | Lists only the current user's pricing positions. |
| `POST` | `/api/pricing-positions/import` | Imports one current, verified, non-quarantined P05-02 position snapshot. |
| `POST` | `/api/pricing-positions/:pricingId/withdrawn` | Applies an optimistic-revision hidden/withdrawn transition after a fresh source snapshot read. |
| `GET` | `/api/pricing-positions/stream` | Streams tenant/user-scoped snapshot, diff, heartbeat, and tombstone events. |

Every route requires an active session. Quote ingress resolves wallet address, Registry router, spender, selector, pool path, gas, and digest on the server. Cross-user and unknown wallet IDs are hidden before the provider is called. Cross-user or malformed pricing IDs receive the same user-scoped not-found result.

Quote responses use `Cache-Control: no-store`, an independent rate limit, a bounded request body, a bounded provider response, and a provider timeout. Provider messages, endpoints, tokens, and response fragments are replaced by stable public error codes. Raw calldata is never accepted or returned.

Evidence: `tests/p05-swap-quote-api.test.ts`, `tests/p05-pricing-position-api.test.ts`, and `tests/p05-pricing-position-sse.test.ts`.
