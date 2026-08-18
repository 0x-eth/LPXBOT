# P04-04 Data Evidence

Migration `20260818000500_create_wallet_lifecycle_security_password.sql` adds wallet delete previews, durable non-secret tombstones, persistent wallet deletion audit support, security-password current/version tables, and security-password audit events.

Preview rows persist only a 32-byte SHA-256 token digest, wallet revision, frozen dependency lists and generated counts, asset-risk digest, force eligibility, confirmation phrase, and timestamps constrained to exactly 300 seconds. Preview creation locks the user/wallet revision. Successful delete explicitly consumes all previews for that wallet inside the same transaction; an injected pre-commit fault restores the preview, wallet, Envelopes, tombstone, and audit state.

Deletion takes a user+wallet advisory transaction lock, rechecks revision and the one-time preview under row locks, inserts the deletion audit and tombstone, removes every recoverable Envelope through wallet destruction, and commits once. Tombstones retain wallet ID, owner ID, address, final revision, deletion type, audit correlation, and deletion time. Tombstone and deletion-audit rows deliberately have no cascading wallet/user foreign keys, so they survive wallet and user deletion. The audit correlation is a unique positive ID without a cross-migration foreign key, preserving P04-02 independent down/up compatibility.

Security-password versions are immutable verifier records with an independent 16-byte salt, frozen Argon2id parameters, KDF domain, 32-byte verifier, and creation time. The database has no plaintext-password, derived-key, derived-KEK, private-key, or fingerprint columns. Current version, failure count, lockout, and audit state are tenant-scoped by user ID.

`pnpm test:postgres` passed 22 files / 95 tests. It applies every migration up, all downs in reverse, and every up again, and covers concurrent mutation/deletion, constraints, fault injection, rollback, re-import, tombstone/audit retention, and restart persistence. Incomplete dependency inventory is rejected before a preview can be committed.
