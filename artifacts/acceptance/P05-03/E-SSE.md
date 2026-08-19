# E-SSE

The first `/api/pricing-positions/stream` connection emits the current user's snapshot and cursor. Subsequent durable events are `diff` or `tombstone`; idle connections receive heartbeat events. Browser parsing rejects extra fields, malformed DTOs, invalid epoch/sequence data, and gaps before applying events through the strict reducer.

Every cursor is HMAC authenticated and binds `tenantId+userId`, epoch, and sequence. `Last-Event-ID` resumes strictly after the last confirmed sequence with finite backfill. A cursor from another user, a changed epoch, a tampered signature, or a sequence older than retention is rejected. Snapshot and replay ordering prevent duplicate application or omission of confirmed events.

The stream service polls PostgreSQL `pricing_position_outbox`; it does not depend on in-process publication. Stream heads and Outbox rows survive API restart. The PostgreSQL restart test imports before reconstructing the store/service, then resumes from the prior cursor and receives the next sequence.

Evidence: `tests/p05-pricing-position-sse.test.ts`, `tests/p05-swap-pricing-client.test.ts`, and `tests/integration/postgres-pricing-position-store.integration.ts`.
