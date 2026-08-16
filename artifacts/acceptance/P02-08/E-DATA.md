# E-DATA

- `packages/market-metrics/src/label-rule-contract.json` is the single runtime source for `pool-labels/local-v1`; the acceptance copy is byte-for-JSON equivalent.
- The contract freezes input windows, minimum samples, Decimal thresholds, priorities, yield/LP exclusivity, score range, stable ordering, ID deduplication, and `omit-label` null policy.
- Rules cover high fee rate, stable volume and price, mutually exclusive stable/surge/decline yield, crowded, volatile, and mutually exclusive LP inflow/outflow.
- All threshold arithmetic uses a 96-digit Decimal clone. No label path substitutes zero, an empty string, or an estimate for missing input.
- Price change uses squared ratios of consecutive, complete canonical `sqrtPriceX96` samples. A missing sample suppresses price labels; no USD price is constructed.
- Migration `20260816000500_add_market_label_context.sql` adds constrained canonical, metric, and label-rule versions to `market_snapshots`.
- The committed Golden input/output freezes three ordered labels and complete reason records. It is locally defined and does not establish target parity.
