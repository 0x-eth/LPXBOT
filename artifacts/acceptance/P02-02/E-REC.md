# E-REC: Atomic recovery, restart, and reorg

Evidence level: `local-fixture-verified` only.

The real PostgreSQL integration suite verifies the following transaction and recovery behavior through `IndexerRunner` and `PostgresCanonicalEventStore`:

- normalized event, five snapshots, durable cursor, and five outbox records commit in one serializable transaction under a chain advisory lock;
- an injected outbox trigger failure rolls back event, snapshot, cursor, and outbox writes together;
- same key plus same payload is a strict no-op;
- same key plus different payload writes one `integrity_quarantine` record without applying the conflicting event;
- process restart resumes from the durable cursor and repeated replay leaves event count, snapshots, metrics, and maximum sequence unchanged;
- explicit removal marks the old event and raw log non-canonical/reverted, rewinds the cursor, emits a tombstone, then applies the replacement branch;
- a stale old-branch redelivery after reorg remains a strict duplicate no-op and cannot revert the replacement branch;
- affected windows are recomputed from canonical events, so replacement output is deterministic.

The golden canonical state and snapshot/diff order are stored in [canonical-store.json](golden/canonical-store.json), [window-results.json](golden/window-results.json), and [sse-transcript.txt](golden/sse-transcript.txt).

The slice does not assign a production BSC confirmation depth. `GAP-FINALITY-DEPTH` remains unresolved, and the fixture sequence is not finality policy.
