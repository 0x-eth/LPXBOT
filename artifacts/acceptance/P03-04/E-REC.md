# P03-04 Recovery Evidence

- Dispatcher tests cover permit-before-claim delivery, unavailable permits, exhausted lease budgets, batch caps, retry, permanent failure, stale lease results, and graceful shutdown with an in-flight delivery.
- The Dispatcher reuses `claimDue`, `markDelivered`, `markRetry`, and `markDead`; all completion writes require the exact lease token. A late provider result is counted as late and cannot overwrite replacement work.
- PostgreSQL recovery tests expire a lease, claim a replacement token, atomically move history from `sending` back through recovery, and reject the old token.
- Process restart recovery uses durable Outbox due rows rather than in-memory work. Provider delivery IDs remain the Outbox delivery ID across attempts.
- Destination resolution checks the current row for enabled/non-deleted state before loading the exact immutable revision bound into the Outbox.
- P03-02 Outbox retry/dead/crash recovery and P03-03 destination selector behavior remain green in the complete 18-file PostgreSQL suite.

No recovery fixture contains credential material, and every resolver/provider dependency is injected locally.
