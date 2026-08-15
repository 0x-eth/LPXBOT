# E-SSE: Durable snapshot/diff stream

Evidence level: `local-fixture-verified` only.

The market stream uses the frozen P02-01 envelope fields `schemaVersion`, `eventType`, `sequence`, `cursor`, `mode`, `emittedAt`, `streamKey`, `epoch`, and `data`. The HTTP `id` equals `cursor`.

## Verified semantics

- a new stream begins from the latest retained snapshot and replays later events in numeric epoch/sequence order;
- a retained Last-Event-ID replays strictly after that cursor;
- a retention miss creates a new epoch and persists a complete recovery snapshot at sequence `1`;
- heartbeats use diff mode, null data, consume sequence, advance cursor, and are durably inserted;
- reorg emits the old-branch tombstone before the replacement upsert;
- duplicate processing does not advance sequence;
- numeric ordering remains correct across sequence `9` to `10`;
- replay reads use `market_stream_outbox_replay`, are bounded to 500 rows per query, and a 600-event fixture crosses the page boundary without loss or duplication.

The fixed [SSE transcript](golden/sse-transcript.txt) contains `retry: 3000`, one full snapshot, old-branch diff, tombstone diff, and replacement diff. PostgreSQL and client reducer tests cover duplicate fingerprints, integrity conflicts, missing sequence, epoch changes, heartbeat validation, stale state, and retained rows during reconnect.

`GAP-API-SSE-RESUME` remains unresolved for target parity; this evidence proves the local contract only.
