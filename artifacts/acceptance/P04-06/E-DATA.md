# P04-06 Data Evidence

Migration `20260818000700_create_wallet_transfers.sql` adds nine narrowly owned PostgreSQL tables:

- `wallet_nonce_ledgers`
- `wallet_transfer_operations`
- `wallet_transfer_idempotency`
- `wallet_transfer_transactions`
- `wallet_transfer_replacement_authorizations`
- `wallet_transfer_outbox`
- `wallet_transfer_reconciliation_cases`
- `wallet_transfer_receipt_evidence`
- `wallet_transfer_audit_events`

The schema constrains canonical lowercase EVM addresses, positive chain IDs and fee fields, exact numeric base units, valid state enums, digest/hash formats, ownership foreign keys, one operation nonce per chain/wallet, one generation per operation, bidirectional replacement references, and a partial unique index for the single active transaction head. Receipt evidence and audit decisions are append-only.

Operation creation performs nonce-row locking/fencing, operation insert, idempotency reservation, and outbox insert in one transaction. The integration observed exactly two operations, two reservations, and two outbox rows after two unique commands plus one concurrent replay. Redis is not consulted for nonce or state decisions.

Passwords, Keystore passwords, raw transactions, private keys, request headers, and provider bodies have no columns. `reauthenticated_session_id` is a non-secret capability binding used by the signer authorizer; password material itself is neither stored nor hashed into the command.

`pnpm test:postgres` passed 24 files / 99 tests with one explicit skip. The isolated migration-cycle database applied all migrations and seed, rolled every migration down in reverse, reconnected, and applied all migrations and repeatable seed again. The legacy P04-02 focused down/up test was updated to roll back P04-06 before its referenced custody table, preserving all foreign keys.
