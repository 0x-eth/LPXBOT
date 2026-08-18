# P04-06 API Evidence

The authenticated transfer surface is:

- `POST /api/wallets/transfers/preview`
- `POST /api/wallets/transfers`
- `GET /api/wallets/transfers/:operationId`

Preview accepts only native currency or a registered standard ERC-20 and either an exact canonical base-unit string or the `25`, `50`, `75`, and `MAX` presets. The service floors percentage results in base units, reserves the full native fee cap for native `MAX`, and requires enough native balance for an ERC-20 fee cap. Floating point, scientific notation, arbitrary calldata, unsupported token metadata, fee-on-transfer tokens, transfer to the source wallet itself, unavailable balances, divergent provider nonces, locked wallets, and disallowed chains fail before operation creation. A different wallet owned by the same user remains a valid `own-wallet` recipient and does not require another security-password challenge.

The preview response binds the resolved amount, fee limit, balance changes, recipient classification, registry version, policy version/digest, execution mode, and expiry into a short-lived token and digest. Submit re-reads the current immutable facts and rejects an expired token or any policy, registry, balance, fee, nonce, recipient, or digest change before signing.

Submit requires `Idempotency-Key`. PostgreSQL scopes it by `userId + wallet.transfer + walletId + idempotencyKey`; the same request hash returns the original operation and a changed request hash returns `409 IDEMPOTENCY_CONFLICT`. The hash excludes the security password, Keystore password, request ID, and client time. Operation, reservation, and outbox rows are created atomically.

New external addresses use `application/vnd.lpbot.wallet-transfer-secret+json`, a bounded no-store ingress, and the P04-04 signer-internal password verifier. Known external addresses use the ordinary no-secret branch. GET is owner-scoped and exposes only the public operation projection; fencing tokens, immutable plans, request hashes, reauthenticated session IDs, password versions, and user IDs are not returned.

Focused result: 8 P04-06 Vitest files / 41 tests passed, including the real Fastify preview/submit/get routes, ownership, replay, conflict, no-store, media type, password zeroization, strict browser response parsing, and no automatic submission retry.
