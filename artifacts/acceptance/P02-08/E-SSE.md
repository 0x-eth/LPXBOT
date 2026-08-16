# E-SSE

- Label computation runs inside the existing serializable snapshot projection transaction from the same canonical events and window as market metrics.
- A label-only row change participates in stable row comparison and emits an upsert. A removed pool emits a tombstone keyed by stable `poolKey`.
- Snapshot and diff events share `canonicalRevision`, `metricVersion`, and `windowEnd`; row labels carry the matching frozen `labelRuleVersion`.
- The client applies label upserts atomically with snapshot version/context, removes tombstones by `poolKey`, rejects malformed envelopes, and retains existing duplicate/sequence-gap recovery behavior.
- Filtered streams preserve the complete label record while applying only the existing protocol filter. Labels do not create a parallel data source or asynchronous consistency path.

Focused reducer, parser, HTTP/SSE, and PostgreSQL tests cover non-empty snapshots, label-only upserts, tombstones, strict parsing, replay, and context propagation.
