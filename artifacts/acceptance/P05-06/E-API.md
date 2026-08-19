# P05-06 E-API

The authenticated local Swap surface adds two write routes while retaining the unified operation query:

- `POST /api/swap/execute/preview`
- `POST /api/swap/execute`
- `GET /api/chain-operations/:operationId`

The existing `POST /api/swap/quote` route now selects the isolated local quote v2 only for chainId 31337. The BSC quote contract remains `p05-bsc-execution-v1` with `executionEnabled=false`; no BSC execution route or allowlist was opened.

Execution preview accepts exactly `walletId`, `quoteDigest`, and `authorizationMode`. Submit accepts only those fields plus `previewDigest` and `previewToken`, requires a 16-128 byte `Idempotency-Key`, and requires the existing reauthentication boundary. Unknown fields are rejected. The strict browser client reconstructs the fixed request objects before serialization, so `target`, `router`, `spender`, `selector`, `calldata`, transaction value, amount overrides, and fee overrides cannot cross the client/API boundary.

The service resolves the authenticated tenant/user wallet and the append-only quote by digest, then rechecks quote age, expiry, deadline, block drift, wallet, token identities, Registry digest, active Helper binding, owner, helper runtime hash, adapter, Permit2, balances, allowances, and Permit2 nonce/domain facts. Preview freezes those facts into an opaque token and digest. Submit atomically consumes the preview facts into a plan, operation, ordered steps, idempotency row, nonce reservations, and Outbox event. Identical duplicate submission returns the original operation; the same key with another request hash returns `IDEMPOTENCY_CONFLICT`.

`tests/p05-local-swap-execution-api.test.ts` and `tests/p05-local-swap-execution-http-api.test.ts` cover stale/changed quotes, deadline and minOut boundaries, wrong wallet/Helper/Registry/code hash, inactive binding, arbitrary-field injection, duplicate replay, payload conflict, reauthentication, foreign ownership, and the unified GET envelope. `tests/p05-local-swap-execution-client.test.ts` covers strict request serialization, response parsing, operation steps, replacement lineage, and ambiguous network errors.
