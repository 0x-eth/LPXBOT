# P04-03 Recovery Evidence

The P04-01 Argon2id known-answer fixture and lifecycle-recovery fixture are replayed by executable tests. The implementation freezes Argon2id v1 at 64 MiB, three iterations, parallelism one, a 16-byte salt, and a 32-byte result. Unsupported parameter versions fail closed and cannot downgrade the stored contract.

Lifecycle coverage verifies:

- independent salt and secret versions on password creation and change;
- stale `expectedVersion`, wrong old password, and concurrent password-change conflicts;
- exponential backoff, five failures in a 15-minute window, lockout expiry, and cross-user/session isolation;
- manual lock, monotonic-clock auto-lock, browser-activity independence, signer restart, and graceful process shutdown;
- atomic password rewrap and bidirectional server-KEK/user-password mode switching;
- old password/envelope usability after injected pre-commit failure;
- a fixed 300-second reset preview bound to user, secret version, wallet/task/strategy/policy counts, positions, nonzero assets, and the asset-risk digest;
- `PREVIEW_EXPIRED`, `PREVIEW_CHANGED`, confirmation mismatch, fail-closed dependency inventory, atomic destruction, and preservation of server-KEK wallets; and
- zeroized ingress, password, derived KEK, raw DEK, and private-key buffers across success, authentication failure, derivation failure, tamper, timeout/abort, rollback, auto-lock, and shutdown paths.

The focused custody regression passed 15 files / 69 tests. P04-02 AES-GCM, AAD tamper, signer restart, KMS failure, and recovery cases remain green. No test signs or serializes a transaction, broadcasts, or reaches an external RPC.
