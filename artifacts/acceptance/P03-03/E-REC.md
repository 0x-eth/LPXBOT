# P03-03 Recovery Evidence

- The monitor worker passes the matched candidate, authoritative monitor definition, and `monitor-match` category to the destination selector.
- Selection requires an exact monitor/revision binding, an explicitly enabled category preference, a current enabled non-tombstone destination revision, and the destination's category opt-in.
- Candidate, selected destination rows, and the evaluation watermark commit in one PostgreSQL transaction. Credential-like Outbox render context is rejected before the transaction starts.
- Outbox rows retain only credential-free render context, `destinationId`, and `destinationRevision`. The SHA-256 dedupe key includes the destination revision.
- Concurrent consumption of the same candidate and revision returns one delivery. A new candidate after a destination revision change receives a new dedupe key; replaying the old candidate does not backfill the new revision.
- Existing P03-01 reorg/dedupe Golden fixtures and P03-02 lease, retry, late-token, terminal, and crash-recovery cases remain green.

The PostgreSQL integration suite also verifies failed multi-row writes roll back candidate, Outbox, and watermark state together.
