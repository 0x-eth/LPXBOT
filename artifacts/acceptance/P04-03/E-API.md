# P04-03 API Evidence

The authenticated Keystore surface is:

- `GET /api/keystore/status`
- `POST /api/keystore/unlock`
- `POST /api/keystore/lock`
- `PATCH /api/keystore/auto-lock`
- `POST /api/keystore/password`
- `PUT /api/keystore/password`
- `GET /api/keystore/reset-preview`
- `POST /api/keystore/reset`
- `POST /api/wallets/:walletId/encryption-mode`

Wallet import and generation also accept `user-password`. Password creation, change, unlock, reset, mode switching, import, and password-mode generation cross the API and loopback signer boundaries through dedicated binary secret ingress. Both boundaries enforce the dedicated media type, `Cache-Control: no-store`, a 16 KiB request limit, one transport attempt, and `finally` zeroization. Ordinary JSON is rejected before secret parsing.

Secret operations require the authenticated user and fresh reauthentication. Unlock capabilities bind the user ID, authenticated session ID, signer instance, secret version, and unlock version. Public Keystore responses contain exactly `configured`, `status`, and `version`; wallet responses retain the existing public wallet allowlist. Passwords, salts, verifiers, KEKs, DEKs, wraps, ciphertext, private keys, preview-token digests, and tenant/user ownership fields are absent from responses.

Unknown Keystores, wrong passwords, and corrupt password-mode envelopes converge on `INVALID_CREDENTIALS`. Optimistic password and mode mutations return stable version or revision conflict codes without leaking secret content. Focused API/client/boundary tests are included in the 15-file / 69-test P04 custody run.

Signing operations: 0. Raw transaction operations: 0. Broadcast calls: 0. External RPC calls: 0.
