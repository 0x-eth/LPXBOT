# P04-02 API Evidence

The custody surface is limited to:

- `GET /api/wallets`
- `GET /api/wallets/:walletId`
- `POST /api/wallets/import`
- `POST /api/wallets/generate`

Every route requires the current authenticated session. Both write routes additionally require an injected fresh-reauthentication verifier. Missing or stale proof returns `REAUTH_REQUIRED` before signer access.

Import accepts only `application/vnd.lpbot.wallet-secret+json` through a dedicated buffer parser. Ordinary JSON is rejected before parsing, the request has a 16 KiB limit, no queue or retry adapter is involved, and the ingress buffer plus the remote transport copy are cleared in `finally` blocks.

The API and remote signer client both rebuild responses through the public `CustodyWallet` allowlist. Wallet ID, name, checksummed address, `server-kek` mode, lock status, envelope version, revision, and timestamps are the only returned fields. Ciphertext, nonce, tag, wrapped DEK, KEK identity, secret reference, key fingerprint, tenant ID, and user ID are excluded.

Cross-user detail reads and malformed or unknown wallet IDs return the same `WALLET_NOT_FOUND` result. `auth_login_wallets` remains an authentication-only domain and creates no custody row or signer grant.

Focused API and adapter coverage passed 9 tests. No private key appeared in response bodies or captured API logs.
