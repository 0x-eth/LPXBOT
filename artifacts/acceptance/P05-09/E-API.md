# P05-09 E-API

The authenticated local Helper upgrade surface is separate from the chainId 56 read-only residual surface. It exposes `POST /api/wallets/helper/upgrade/preview`, `POST /api/wallets/helper/upgrade`, `GET /api/helper-upgrades/:operationId`, and `GET /api/wallets/:walletId/helper-upgrade`. Runtime composition admits only a non-forked local Anvil chainId 31337 Registry.

Preview accepts exactly `chainId` and `walletId`. Submit accepts exactly those fields plus opaque `previewDigest` and `previewToken`, and requires both a stable `Idempotency-Key` and fresh reauthentication. Exact-key parsers reject bytecode, helper, target, selector, calldata, recipient, Registry override, fee override, or any additional browser-controlled field. The public preview and operation views never return init code, arbitrary calldata, raw signed transactions, custody material, or Signer credentials.

Preflight revalidates the wallet, active WalletHelperV1 binding, immutable owner, runtime and Registry identity, complete residual coverage, two-provider block and nonce consensus, no wallet nonce conflict, and no live operation. The server derives the WalletHelperV2 init code, CREATE target, instance runtime hash, typed plan, nonce, fencing token, gas limit, fee cap, recipient identities, and plan digest from frozen Registry and chain facts.

Submission is idempotent for identical content and rejects reuse with changed content. Operation and latest queries are tenant/user/wallet scoped and return version comparison, seven persisted step states, deployment transaction lineage, manual recovery blockers, sweep provenance, and current cursor. Another user receives not-found semantics rather than cross-scope data.

`tests/p05-local-helper-upgrade-api.test.ts`, `tests/p05-local-helper-upgrade-http-api.test.ts`, and `tests/p05-local-helper-upgrade-client.test.ts` cover preview/submit/query, reauthentication, idempotency, strict request and response schemas, local gate closure, provider/nonce divergence, and arbitrary execution-field injection.
