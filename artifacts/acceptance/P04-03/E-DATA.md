# P04-03 Data Evidence

Migration `20260818000400_create_user_keystores.sql` extends custody mode to `server-kek | user-password`, adds versioned password DEK-wrap fields to wallet envelopes, and creates signer-owned `user_keystores`, `user_keystore_versions`, `user_keystore_failures`, and `user_keystore_reset_previews` tables.

Persistent password metadata is limited to an independent 16-byte salt per secret version, frozen Argon2id parameters, a 32-byte authentication verifier, current/version state, the approved auto-lock setting, failure-window counters, and reset-preview digests. Passwords, derived KEKs, raw DEKs, and private keys have no database columns. Password-mode wallet envelopes persist an independent 12-byte wrap nonce, 16-byte authentication tag, 32-byte wrapped DEK, wrap version, secret version, and authenticated envelope material.

Password rotation locks the user row, retires the prior secret version, inserts the new version, re-envelopes every password-mode wallet, advances optimistic wallet pointers, and commits once. Mode switching checks both `expectedRevision` and `expectedSecretVersion`. Reset deletes all password-mode wallet recovery material and the user Keystore in one transaction while preserving server-KEK wallets. Injected pre-commit failures roll back every affected row.

`pnpm test:postgres` passed 20 files / 89 tests. The suite applies every migration up, all downs in reverse, and every up again. It covers concurrent password creation, persistent session-scoped lockout, password rewrap, restart recovery, lifecycle fault rollback, reset isolation, and all prior PostgreSQL invariants.
