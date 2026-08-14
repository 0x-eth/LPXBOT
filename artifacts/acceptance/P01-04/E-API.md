# E-API: Login wallet authentication contracts

## Scope

- Feature IDs: `AUTH-03`, `AUTH-04`.
- Evidence level: `local-fixture-verified`.
- EOA message signing and recovery: verified with runtime-generated Viem test accounts.
- EIP-1271 contract-wallet verification: `not-implemented` and `not-verified` in P01-04.

## HTTP contract

| Route | Authentication | Request | Successful response |
|---|---|---|---|
| `POST /api/auth/wallet/nonce` | anonymous | `address`, `chainId` | `nonceId`, canonical SIWE `message`, `expiresAt` |
| `POST /api/auth/wallet/login` | anonymous | `address`, `chainId`, `nonceId`, `signature` | credential-free `SessionView`; opaque token only in the session cookie |
| `GET /api/auth/wallet/links` | current session | none | `linkId`, masked address, `label`, `createdAt`, `updatedAt` |
| `POST /api/auth/wallet/link-nonce` | current session | `address`, `chainId` | user-bound link challenge |
| `POST /api/auth/wallet/link` | current session | `address`, `chainId`, `nonceId`, `signature`, `label` | masked login-wallet link view |
| `DELETE /api/auth/wallet/link/{linkId}` | current session | path `linkId` | `{ deleted: true }` |

The API ignores any client-supplied user identifier and derives link ownership from the authenticated session. Default one-minute limits are 10 challenge requests, 10 signature submissions, and 30 list requests per rate-limit key; exceeded limits use the stable `RATE_LIMITED` envelope.

## Challenge and verification

- `getAddress` normalizes the submitted address, while `createSiweMessage`, `parseSiweMessage`, and `validateSiweMessage` provide the EIP-4361 implementation.
- A 32-byte cryptographically random `nonceId` is returned as 43-character base64url. The SIWE nonce is derived with HMAC-SHA-256 from that identifier and an explicit 32-byte server key.
- The canonical message binds address, domain, URI, chain ID, issued time, expiration time, and `urn:lpbot:auth-purpose:{login|link}`. Link challenges additionally bind `urn:lpbot:auth-user:{userId}`.
- The server reconstructs the exact canonical message, matches its stored hash and nonce hash, validates all SIWE fields, and delegates EOA verification to Viem `verifyMessage`.
- Wrong signer, address, chain, domain, URI, purpose, user, expiration, replay, and concurrent reuse are rejected. A failed pre-consumption verification does not consume the challenge.
- Login and link challenges cannot cross purposes. A link challenge cannot cross users.

## Session and response boundary

Successful login reuses `SessionIssuer`. The opaque session credential is stored only as a hash and delivered through an HttpOnly, Secure, SameSite=Lax cookie. JSON responses and structured request logs contain neither the session token nor the submitted signature, nonce identifier, or complete challenge.

The focused wallet suite passed 7 files and 50 tests. The complete suite passed 17 Vitest files and 126 tests plus 19 governance tests. All accounts and private keys used by tests were generated at runtime through Viem and were not committed.
