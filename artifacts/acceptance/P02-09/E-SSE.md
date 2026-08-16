# E-SSE

- A recommendation connection reads and sends the current `rec_pools_snapshot` immediately, before beginning periodic checks.
- The scheduler is injectable. Fake-clock coverage verifies the 5,000 ms recommendation check, 25,000 ms heartbeat, non-overlapping reads, and complete timer cleanup.
- A new source version with identical ordered wire rows does not emit another recommendation snapshot. Member, order, fee, symbol, or any other wire-field replacement changes the hash and emits a new snapshot.
- Every recommendation event carries `sourceWindow=5`, `sourceVersion`, `sourceWindowEnd`, `selectionHash`, and an SSE ID equal to its cursor.
- The cursor binds chain, limit, source version, source window end, and selection hash. Reconnect sends the last committed recommendation cursor through `Last-Event-ID`.
- Recommendation sequence handling is independent from the STATS-01 lane. A recommendation may arrive before any stats snapshot, and a nullable-sequence heartbeat updates only liveness.
- Closing the transport aborts timers and the active provider read. The PostgreSQL adapter destroys an in-flight query connection and rejects it as `AbortError`.

Focused API, stream, client, and cancellation suites passed, including malformed cursor, matching reconnect, unchanged payload, replacement payload, heartbeat, and abort paths.
