# E-SEC: Login wallet credential and domain boundaries

## Challenge secrecy and replay

- Challenge identifiers contain 32 random bytes. SIWE nonces are HMAC-SHA-256 derivations under an explicit 32-byte server key.
- PostgreSQL stores only 32-byte `id_hash`, `nonce_hash`, and `message_hash` values. It has no plaintext nonce, complete message, or signature column.
- Addresses are normalized with Viem and persisted as exactly 20 bytes. Application comparisons use lowercase hexadecimal form.
- Challenges are time bounded, purpose bound, single use, and consumed inside a row-locking transaction. Real PostgreSQL concurrency testing observed one success and one stable replay rejection.
- Wallet authentication stays disabled when `WALLET_AUTH_CHALLENGE_KEY_BASE64` is empty and rejects malformed or weak key material. Domain and URI are mandatory and must match.

## Browser and logging

- The EIP-1193 adapter requests only accounts, chain ID, and `personal_sign`. Static and runtime tests reject signer imports and assert the absence of transaction, transaction-signing, chain-switch, and chain-add RPC calls.
- Private keys, mnemonics, signatures, nonce identifiers, complete challenges, and session credentials are not written to `localStorage` or `sessionStorage`.
- API responses never return session tokens. Tests assert that session tokens, signatures, and nonce identifiers do not enter JSON responses or structured logs.
- Labels are normalized to NFC, trimmed, limited to 64 Unicode code points, and reject control or format characters. React text rendering provides output escaping.

## Verification limits

EOA verification is `local-fixture-verified` through Viem `verifyMessage` and runtime-generated Viem accounts. EIP-1271 contract-wallet signature verification is `not-implemented` and `not-verified`; P01-04 makes no claim for that capability.

## Scans and external boundary

- Dockerized Gitleaks 8.30.0 scanned 205 commits and approximately 17.98 MB with no leaks found.
- `pnpm audit:dependencies` reported no known vulnerabilities.
- CI run `31787475239` passed the Security job, including full-history Gitleaks and dependency audit.
- No real wallet, user private key, mnemonic, production signature, target-site request, external RPC, token authorization, transaction broadcast, funds action, or production write occurred.
