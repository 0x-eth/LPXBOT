# E-REC

- PostgreSQL integration verifies canonical constraints, per-user isolation, adapter-recreation persistence, capacity, cascading cleanup, and stable V3/V4 identities.
- Two mutations using the same expected revision execute concurrently; exactly one returns `updated` and the other returns `conflict`. The stored entry count and revision remain consistent.
- Cross-device behavior is represented by independent sessions sharing one user revision. A stale writer receives the current authoritative snapshot and cannot overwrite it.
- The client reducer tracks mutations by identity. Failure removes only the failed optimistic operation, reapplies later pending operations, and ignores a late response after that mutation has settled.
- A revision conflict adopts the server snapshot, reapplies still-pending local operations for display, and exposes an explicit conflict state requiring reload or a subsequent current-revision mutation.
- Top-fees, by-token, recommendations, grouping, comparison, expanded detail, and the status-bar recommendation projection consume the shared policy. Filtering occurs before final sort/limit where selection is performed.
- Monitoring and strategy business modules are absent in this phase; only the shared `PoolEligibilityPolicy` consumer interface is exported and contract-tested for them.
