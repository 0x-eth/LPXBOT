# P03-02 Recovery Evidence

- Every P03-01 evaluation case, dedupe ordering case, reorg replacement case, and Outbox recovery rule is loaded directly from the frozen fixture directory and replayed by tests.
- Inputs are deduplicated and ordered by `windowEnd`, exact RFC3339 `generatedAt`, and byte-ordered `sourceGenerationId` before evaluation.
- One logical monitor/revision/pool/window/version produces one candidate key. A newer canonical generation replaces pending/retry evidence atomically; terminal evidence is suppressed and audited.
- Candidate, all selected destination Outbox rows, and the monotonic watermark share one PostgreSQL transaction. A valid first Outbox insert followed by an invalid destination rolls back all three record types.
- Per-user advisory locking prevents concurrent creates with different keys from exceeding capacity. Row locking permits one revision mutation winner.
- Claims use `FOR UPDATE SKIP LOCKED`, a 60-second lease, per-claim tokens, and bounded deterministic retry. Expired leases recover without duplicate delivery, late tokens are rejected, and the sixth failed attempt becomes `dead/MAX_ATTEMPTS` immediately.

Focused PostgreSQL result: monitoring persistence plus complete migration cycle passed 2 files / 7 tests.
