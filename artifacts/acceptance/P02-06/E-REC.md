# E-REC

- Canonical ingestion uses a serializable transaction and a per-chain advisory transaction lock. A failure before commit rolls back the raw log, normalized event, catalog, snapshots, outboxes, and cursor together.
- Identical deliveries are deduplicated without advancing catalog or market sequence twice. Same-key different-payload deliveries are quarantined and do not mutate the canonical projection.
- Reorg handling first marks the old branch noncanonical, emits affected tombstones/diffs, rewinds the durable cursor to the canonical ancestor, and rebuilds each affected catalog key from remaining canonical events.
- Replacement-branch replay then establishes only the replacement identity. A later stale delivery from the old branch remains a strict no-op, so the orphaned pool identity cannot reappear.
- Retained market cursors replay strictly after `Last-Event-ID`; a retention miss starts a new epoch with a complete snapshot. Replay reads remain bounded to 500 outbox rows.
- Preference writes use compare-and-swap revision control. A stale device receives `409 PREFERENCES_CONFLICT`; the server copy remains authoritative. A transport/server failure restores the exact last saved columns, while a conflict refreshes the current server revision before further edits.
- A second authenticated device and a later login read the same saved column order/visibility. Schema migration preserves the stored revision, preventing a migration-only read from creating a false write conflict.

PostgreSQL recovery tests cover restart replay, duplicate delivery, replacement reorg, stale old-branch delivery, retained and missed cursors, preference conflicts, migration, and cross-device relogin.
