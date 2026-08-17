# P02-13 Data Evidence

The migration `20260817000400_create_task_status_stats_projection.sql` creates:

- one readiness row in `task_status_stats_projection_state`;
- authoritative per-user absolute snapshots in `task_status_stats_user_snapshots`;
- persistent global and user stream heads in `task_status_stats_stream_heads`;
- revision conflict hashes in `task_status_stats_conflicts`;
- credential-free administrator filter summaries in `task_status_stats_query_audit_events`.

Every count, source revision, scope sequence, and derived three-state total is constrained to a non-negative JavaScript safe integer. `total` is never stored. Content hashes cover only the three public counts; source payload hashes independently enforce revision idempotency/conflict semantics.

The publisher locks readiness plus both stream heads and commits user snapshot, recomputed global aggregate, hashes, and both sequences in one transaction. A user deletion emits a persistent user zero tombstone and recomputes the global head in the deleting transaction.

`pnpm db:migrate` succeeded on first corrected application and on immediate repetition. The full migration-cycle integration test applied every migration, ran all downs in reverse, reconnected, reapplied every migration, and preserved repeatable seed behavior.
