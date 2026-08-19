# P05-05 E-REC

P05-05 reuses the P04 nonce fencing, idempotency, transaction-generation, replacement, receipt-recovery, reconciliation, and Outbox patterns. Every Outbox claim receives an independent plan snapshot. Historical plans are structurally checked at the final millisecond before their recorded deadline, while the isolated Signer still applies current time and rejects a genuinely expired queued plan before signing.

Unit recovery tests cover queued -> signed/broadcast/pending/confirmed/succeeded transitions, dropped/reconciling decisions, receipt transaction-hash/status validation, replacement fee bounds, and immutable deployment material. PostgreSQL recovery tests prove expired-lease reclaim after Worker restart, pre-broadcast nonce rollback with a higher fencing token, append-only audit/receipt evidence, and correct active-head switching when the original transaction wins after a replacement was broadcast.

A reverted receipt produces a degraded binding and advances the confirmed nonce, permitting a clean next-nonce retry. The real Anvil path reconstructs the Worker between broadcast and observation and still closes the operation and binding. Duplicate operation submission returns the original operation; a reused idempotency key with a different payload digest is rejected.
