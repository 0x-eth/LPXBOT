# E-API

- `MarketPoolRow` requires `labels` and `labelRuleVersion`; no-label rows use `[]` and never omit the field.
- Every label contains `id`, localized `label`, bounded integer `score`, `reasons`, `ruleVersion`, and `computedAt`. Every reason records stable `code`, `window`, Decimal `observed`, Decimal `threshold`, and `operator`.
- Top-fees HTTP snapshots and SSE snapshot/diff rows expose the same label record. Snapshot and diff payloads also carry `canonicalRevision`, `metricVersion`, and `windowEnd`.
- Strict browser parsing rejects missing label arrays, missing context, invalid scores, malformed reasons, and unknown label identifiers before reducer state changes.
- The by-token read model carries the current canonical window's label fields and falls back to the versioned empty-label contract when no current metric row exists.

Focused API tests use a non-empty label fixture and assert byte-for-structure equality between the HTTP snapshot and SSE upsert.
