# P04-05 Data Evidence

Migration `20260818000600_create_wallet_assets_address_book.sql` adds three narrowly owned tables:

- `custody_wallet_custom_tokens`, keyed by user, wallet, chain, and canonical token address.
- `wallet_address_book_entries`, keyed independently from `address_remarks`, with per-user/per-chain canonical-address uniqueness and optimistic revision.
- `wallet_address_book_audit_events`, an append-only allowed/denied decision log without labels, notes, passwords, headers, or provider bodies.

Database checks constrain positive chain/revision values, lowercase canonical addresses, ERC-20 metadata lengths, allowed categories, timestamps, and foreign-key wallet ownership. Custom token writes return created, duplicate, or metadata-conflict atomically. Address-book patch uses an expected revision; stale updates fail without partial mutation. Default tokens are registry data and are never represented as deletable custom rows.

All balances and valuations remain exact strings at API and web boundaries. Base-unit conversion, price multiplication, and total aggregation use `BigInt` plus explicit decimal scale. No PostgreSQL floating amount column and no JavaScript floating amount calculation was added.

`pnpm test:postgres` passed 23 files / 98 tests. The isolated migration-cycle database applied every migration, applied the repeatable seed, rolled every migration down in reverse order, reconnected, and applied every migration and seed again. The focused PostgreSQL suite also proved tenant isolation, canonical constraints, duplicate metadata handling, optimistic revisions, append-only audit enforcement, and zero rows written to `address_remarks`.

The CI-equivalent infrastructure sequence also passed: migration twice, seed twice, all four services healthy, and `pnpm test:infra` 8/8. Its strict public-schema inventory includes all three P04-05 tables.
