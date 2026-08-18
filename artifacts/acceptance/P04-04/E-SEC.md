# P04-04 Security Evidence

- Wallet rename is metadata-only and does not call signer recovery, open an Envelope, derive a key, or change encryption versions.
- Delete tokens use 32 random bytes; only their SHA-256 digest is persisted. Confirmation phrases are server-generated and bound to the frozen preview.
- Successful deletion removes the wallet and all current/historical recoverable Envelopes, revokes signer and unlock capabilities, and retains only a non-secret tombstone plus append-only audit correlation.
- Security password uses `lpbot-security-password-kdf/v1`, independent random salt, fixed Argon2id parameters, verifier domain, versions, failures, lockout, audit records, and sessions. It shares no Keystore salt, KEK, verifier, or session even when the text is identical.
- Dedicated secret ingress is no-store, no-log/no-capture, limited to 16 KiB, never retried, and cleared at browser transport, API, signer HTTP, password, derived-key, and verifier buffer ownership boundaries.
- Public DTOs expose no password mask, salt, verifier, digest, fingerprint, key material, or private dependency identifiers outside the frozen delete preview contract.

Gitleaks 8.30.1 scanned 1073 commits and approximately 23.47 MB of full history with no leaks. `pnpm audit:dependencies` reported no known vulnerabilities. An added-line scan from baseline found zero transaction-signing, raw-transaction, broadcast, wallet-client RPC, or external fetch calls in the P04-04 implementation.

Private-key decryptions: 0. Signing operations: 0. Raw transaction operations: 0. Broadcast calls: 0. External RPC calls: 0.
