# P04-02 Data Evidence

Migration `20260818000300_create_custody_wallets.sql` creates:

- user-scoped `custody_wallets` metadata with an atomic current-envelope pointer;
- append-only `custody_wallet_envelopes` versions; and
- append-only custody audit events.

The active/recoverable uniqueness index is `(user_id, address_lower)`, so duplicate addresses for one user fail while the same address can be independently managed by another user. Wallet metadata, one envelope, the current pointer, and the allowed audit event commit in one PostgreSQL transaction. An injected failure before commit left zero wallet, envelope, pointer, or audit records.

Envelope rows contain exactly wallet/version metadata, `AES-256-GCM` ciphertext, 12-byte nonce, 16-byte authentication tag, AAD version, wrapped DEK, KEK ID/version, and creation time. There is no plaintext private-key, raw DEK, or raw KEK column.

The complete PostgreSQL suite passed 19 files / 86 tests. It applied every migration up, all downs in reverse, and every up again; it also covered concurrent same-user creation, cross-user isolation, constraints, transaction rollback, restart persistence, and all prior schema/seed invariants.

The post-test local database scan returned `0|0|0` for wallet, envelope, and custody audit rows. Outbox schemas contain zero private-key, ciphertext, wrapped-DEK, or KEK columns.
