# E-SSE

- Top-fees snapshot and diff rows share the expanded identity contract: `poolKey`, `poolAddress`/`poolId`, token0/token1 addresses, `feePips`, `tickSpacing`, and `hooks` are present on both paths.
- The market reducer applies snapshots, upserts, and tombstones by stable `poolKey`. Duplicate cursors are ignored, sequence gaps reconnect without applying partial data, epoch changes require a complete snapshot, and stale/reconnecting states keep the last good rows.
- Group keys use `chainId + canonical token address`. Default ranking groups only when the frozen BSC quote-token registry identifies exactly one non-quote Token. Token search results use the searched Token explicitly. Ambiguous pairs remain independent pool groups.
- Group headers always use the first member from the current stable result order. Collapsed groups display `+N`; expanded groups preserve that member order.
- After an SSE upsert or tombstone, expansion is retained only for a still-existing multi-row group. Empty and no-longer-expandable groups are removed from the expansion set.
- Search state exposes reconnecting when a pool-mode search is restored over the last good real-time list while the stream reconnects. Clearing search returns to the live reducer without creating a second data source.

Focused reducer/client tests cover snapshot/diff identity, stable decimal sorting, duplicate and gap handling, canonical grouping, symbol collisions, expansion retention, tombstones, and vanished groups.
