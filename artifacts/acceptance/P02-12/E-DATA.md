# E-DATA

- `provenance-contract.json` freezes creator as the user attached to an LPXBOT-recorded create operation, not a chain transaction sender or inferred owner.
- `pool_creation_provenance` is append-only and independently constrains UUID operation/user identifiers, BSC chainId 56, lowercase 20-byte V3 and 32-byte V4 pool keys, protocol/identity consistency, fee pips, transaction hash, outcome, schema version, and completion time.
- New `created` rows require both `creator_address` and `tx_hash`. Nullable values remain readable for legacy rows and `already_exists` attempts.
- The unique operation ID and payload hash implement same-payload idempotency. A different payload for an existing operation conflicts and records only hashes plus mismatched field names as safe evidence.
- History is indexed and ordered by `(completed_at DESC, id DESC)`. Attribution indexes select the earliest `created`, or only when absent the earliest `already_exists` with `ALREADY_EXISTS_NOT_PLATFORM_FIRST`.
- The ledger deliberately has no user foreign key, so a deleted user's immutable operation remains attributable with a null profile. Profile fields are left joined only when authorized reads are serialized.
- The catalog may normalize and validate an identity but is never queried as an attribution source.
- First migration, repeated migration, and the full reverse down/restored up cycle are covered by PostgreSQL integration tests.

