# E-DATA

- `buildLiquidityFlowProjection` first applies the current protocol selection and every UI filter, then passes that one selected event array to the stream view, summary, and address aggregation. Its input is the replay reducer's stable-ID deduplicated, tombstone-applied canonical array.
- USD arithmetic uses an 80-digit `Decimal` clone and emits decimal strings. No USD amount is converted through `Number`. Add and remove values contribute to inflow/outflow/net; create contributes to event/address/pool counts but not to valuation.
- A null USD on add/remove increments `unvaluedEventCount`, marks the summary or address `partial`, and is excluded from the valued subtotal. The UI prefixes partial money with `已估值`; it does not present the known subtotal as an exact total.
- Address keys are lowercase canonical addresses. Pool cardinality uses the deduplicated lowercase `pool_address ?? pool_id` identity. Equal sort keys fall back to ascending canonical address.
- `address_remarks` is unique on `(user_id, chain_id, canonical_address)` and constrains chain 56, canonical lowercase EVM addresses, trimmed control-free labels, 32 Unicode characters, and meaningful label/watch state.
- A clean migration, a repeat no-op migration, two deterministic seeds, and the complete reverse-down/up PostgreSQL suite passed. The final PostgreSQL run covered 11 files and 39 tests.

No missing USD, NFT, in-range state, or absent V4 amount is inferred. `GAP-FLOW-USD-VALUATION` and `GAP-FINALITY-DEPTH` remain unresolved.
