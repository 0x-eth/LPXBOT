# P05-05 E-API

The authenticated Helper deployment surface contains exactly three routes:

- `POST /api/wallets/helper/deploy/preview`
- `POST /api/wallets/helper/deploy`
- `GET /api/chain-operations/:operationId`

Preview ingress accepts only `chainId`, `helperVersion`, and `walletId`. Submit adds only `previewDigest` and `previewToken`, and requires a 16-128 byte `Idempotency-Key`. Both parsers reject unknown properties, so `target`, `selector`, `calldata`, `bytecode`, constructor fields, `to`, and `value` cannot cross the client/API boundary. The browser client reconstructs the allowlisted JSON objects before serialization even if its runtime caller supplies extra properties.

The service resolves the authenticated tenant/user wallet, requires a ready custody wallet, fixes chainId to 31337 and helper version to `WalletHelperV1`, derives CREATE address from wallet address plus the reserved nonce, and generates constructor material on the server. Submit returns `202` for a new queued operation and the same operation for an identical idempotent replay; the same key with another payload digest returns `IDEMPOTENCY_CONFLICT`. Stale/changed previews and nonce drift fail closed.

`tests/p05-helper-deployment-api.test.ts` and `tests/p05-helper-deployment-http-api.test.ts` cover the service and HTTP boundary, including unknown-field injection, duplicate replay, payload conflict, stale preview, wrong chain, foreign wallet/operation access, and exact response envelopes. `tests/helper-deployment-client.test.ts` adds strict browser response parsing and request serialization coverage.
