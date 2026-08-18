# P04-03 Security Evidence

- Argon2id v1 is fixed at 64 MiB, three iterations, parallelism one, 16-byte random salts, and 32-byte KEKs. Every password version receives a new salt and unsupported parameter versions fail closed.
- The password KEK authenticates the user and wraps each wallet's independently generated DEK. It never encrypts wallet private-key data directly.
- Password DEK wraps use AES-256-GCM with an independent nonce, tag, version, and AAD binding tenant, user, wallet, envelope version, secret version, and wrap version.
- Passwords, derived KEKs, raw DEKs, and private keys exist only in signer-owned mutable buffers. Explicit no-copy buffer views avoid abandoned secret byte copies; all owned buffers are cleared on success, validation/authentication failure, KDF failure, tamper, abort, rollback, auto-lock, and shutdown paths.
- Failure responses do not distinguish wrong password, missing Keystore, or damaged password-mode ciphertext. Backoff and lockout state is isolated by user and authenticated session.
- Secret HTTP routes use dedicated media types, no-store, 16 KiB limits, bounded timeouts, no queue, and no automatic retry. Passwords are excluded from structured logs, response bodies, URLs, browser persistence, and telemetry.

Gitleaks 8.30.1 scanned 1022 commits and approximately 23.21 MB of full history with no leaks. `pnpm audit:dependencies` reported no known vulnerabilities.

Signing operations: 0. Raw transaction operations: 0. Broadcast calls: 0. External RPC calls: 0.
