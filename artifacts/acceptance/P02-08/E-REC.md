# E-REC

- Reorg handling marks the orphan event noncanonical, rebuilds affected pool state, and recalculates labels before the transaction commits.
- The PostgreSQL replacement-branch test observes an old `high-fee-rate` label, a stable `poolKey` tombstone, and a replacement upsert with `labels: []`. The final canonical snapshot contains no orphan label.
- Re-delivering the fixture after the replacement branch accepts no event, advances no snapshot/outbox sequence, and leaves the canonical label state byte-equivalent.
- Migration down/up coverage includes the label-context migration in dependency order.
- User preference schema v4 rows migrate to v5 without revision changes. Navigation order/visibility, theme, color, pool-column order/visibility, panel, hot-pool, scan-tab, and task-view values remain intact while `showPoolLabels` defaults to true.
- An explicit false `showPoolLabels` value survives normalization, persistence, reload, and the existing optimistic revision boundary.
