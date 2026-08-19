# P05-07 E-API

The authenticated local Position surface adds current-snapshot discovery and four write routes while retaining the unified operation query:

- `GET /api/positions/local-current?walletId=...`
- `POST /api/positions/collect-fees/preview`
- `POST /api/positions/collect-fees`
- `POST /api/positions/remove-liquidity/preview`
- `POST /api/positions/remove-liquidity`
- `GET /api/chain-operations/:operationId`

Current snapshots are selected only for the authenticated `tenantId + userId + walletId`, return the latest row for each `(platformId, tokenId)`, use `Cache-Control: no-store`, and revalidate expiry, canonical block identity, owner/approval, position values, Registry, Manager ABI/runtime code hash, and token code identities against the live local chain. The endpoint accepts only `walletId`; query injection is rejected. A closed local gate returns no executable snapshot surface.

Collect preview accepts exactly `walletId`, `platformId`, `tokenId`, and `snapshotDigest`. Remove preview adds only `percent`, `slippageBps`, and `burnIfEmpty`. Submit adds only opaque `previewDigest` and `previewToken`, requires a 16-128 byte idempotency key and reauthentication, and atomically creates the operation and ordered steps. A byte-identical duplicate returns the original operation; a conflicting use of the key is denied. Zero-owed collect is a canonical idempotent success rather than an inferred no-op.

The strict API parsers and browser client reconstruct exact objects. They reject manager, target, selector, calldata, recipient, liquidityDelta, amount0Max, amount1Max, amount0Min, amount1Min, deadline, fee, feeLimit, and serviceFeeBps injection. Percent must be an integer from 1 through 100; slippage must be an integer from 1 through 500 bps; partial removal cannot request burn.

`tests/p05-local-position-execution-api.test.ts` covers 1/25/50/99/100 previews, integer floor and zero liquidity delta denial, zero-owed duplicate collect, stale/reorg/changed snapshot, changed owner/approval, wrong platform, unknown tokenId, malicious Manager code hash, malicious token code hash, nonce provider divergence, and strict ingress. `tests/p05-local-position-execution-http-api.test.ts` covers authentication, reauthentication, tenant/user/wallet ownership, foreign operation denial, local-current isolation, query injection, all four writes, unified GET, idempotency, and the closed chain gate.
