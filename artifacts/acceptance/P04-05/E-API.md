# P04-05 API Evidence

The authenticated read surface is:

- `GET /api/wallets/:walletId/balances?chainId=...`
- `GET /api/wallets/:walletId/tokens?chainId=...`
- `POST /api/wallets/:walletId/tokens`
- `DELETE /api/wallets/:walletId/tokens/:tokenAddress?chainId=...`
- `GET /api/wallets/:walletId/receive?chainId=...`
- `GET /api/address-book?chainId=...&address=...`
- `POST /api/address-book`
- `PATCH /api/address-book/:entryId`
- `DELETE /api/address-book/:entryId`

Every wallet route resolves the authenticated user's wallet before reading data. Cross-user wallet and address-book identifiers converge on not-found responses. Every chain-bearing request passes the chain registry and current chain-access policy; missing, incomplete, disabled, or mismatched chains return `CHAIN_NOT_ALLOWED` before provider access.

Balances expose canonical base-unit and decimal strings. USD price/value fields are decimal strings or null. Missing and stale prices set `usdValueDecimal=null` with `priceStatus=missing|stale`; a total is null when any included value is unavailable. The API never parses an amount through JavaScript floating-point arithmetic.

Token import reads code plus ERC-20 `name`, `symbol`, and `decimals` through the injected controlled provider. EOA code, malformed ABI responses, invalid metadata, duplicates, and metadata conflicts have distinct stable errors. Default tokens cannot be mutated or deleted. Receive responses contain a canonical EIP-681 URI and exact optional amount/base-unit fields.

New external address creation uses the dedicated secret media type, no-store behavior, bounded ingress, and the P04-04 signer-internal security-password verifier. The password is removed from parsed input and cleared at each ownership boundary. Patch and delete do not accept a password or alter `address_remarks`.

Focused API result: `tests/wallet-assets-api.test.ts` and `tests/address-book-api.test.ts` passed as part of the 5-file / 22-test focused suite.

Private-key decryptions: 0. Signing operations: 0. Raw transaction operations: 0. Broadcast calls: 0. Public RPC calls: 0.
