# P05-09 E-DATA

Migration `20260821000100_create_local_helper_upgrade.sql` adds a dedicated durable upgrade ledger. `local_helper_upgrade_previews` stores immutable opaque preview facts. `local_helper_upgrade_operations` stores tenant/user/wallet scope, source binding, expected V2 identity, snapshot and typed plan payload/digests, nonce/fencing, seven-step cursor, sweep provenance, verification, final rescan, manual recovery, and active transaction pointer.

`local_helper_upgrade_steps` persists the ordered preflight, deploy-v2, verify-v2, sweep-v1, final-rescan-v1, atomic-binding-switch, and completed states. Transaction and replacement tables preserve generation lineage, fee fields, init-code and plan identity, signed transport, replacement links, and one active generation. Separate deployment receipt, V2 verification, final rescan, Outbox lease, and audit tables retain recovery evidence. Preview, receipt, verification, rescan, and audit evidence are append-only; public access is revoked from every new table.

One live upgrade per tenant/user/wallet/chain, one active transaction per operation, and one pending replacement authorization are enforced by partial unique indexes. The existing binding table is versioned for WalletHelperV1 and WalletHelperV2, gains `superseded` state and provenance checks, and has a unique index permitting exactly one `active` binding per tenant/user/wallet/chain across versions.

The final binding switch runs in a SERIALIZABLE database transaction. It locks the operation and bindings, rechecks the confirmed V2 evidence, clean final V1 rescan, live operation set, expected active V1 binding, and absence of another active binding, then compare-and-swaps V1 to `superseded` and V2 to `active` before committing the completed cursor.

`tests/p05-local-helper-upgrade-migration.test.ts` checks constraints, indexes, append-only triggers, PUBLIC revocation, and reverse order. `tests/integration/postgres-local-helper-upgrade.integration.ts` exercises the full persisted lifecycle, one-active-binding CAS, no replay, replacement lineage, sweep provenance, manual recovery, RBAC, idempotency, and immutable evidence.
