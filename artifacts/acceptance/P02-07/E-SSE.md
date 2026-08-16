# E-SSE

- The pool stream reducer applies one diff to one immutable snapshot value: tombstones, upserts, rows, and `version` change together before filters, grouping, sorting, and comparison render.
- An upsert immediately refreshes selected comparison values and re-evaluates all active filters from the same row collection. It cannot leave a selected pool on an older metric version.
- A tombstone removes the matching stable `poolKey` from the row set and comparison selection. One remaining pool changes comparison status from ready to `one-selected`; zero changes it to `none-selected`.
- Comparison bindings record the snapshot window, version, and as-of `windowEnd`. All displayed pools and best-value decisions are projected from that one bound snapshot.
- Unresolved values render as unavailable and are excluded from best-value selection. `Fee Tier` is formatted only from canonical `feePips` and is never inferred from display text.
- Focused SSE/state tests passed within the 62-test run, including snapshot, diff, replay ordering, upsert/filter refresh, tombstone reconciliation, and version/window rebinding.
