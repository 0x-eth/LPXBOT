# E-SSE

- P02-05 does not add a statistics endpoint. FLOW-03 and FLOW-04 are deterministic projections of the same currently loaded, UI-filtered event window delivered by the existing P02-04 backfill/SSE client.
- The reducer applies stable-ID deduplication and reorg tombstones before projection. Tombstones arriving before or after an event prevent the reverted event from reappearing.
- While paused, records remain buffered. Resume reduces buffered records through the same dedupe/tombstone path before summary and address aggregation are recomputed.
- Reconnect backfills and live events share the same reducer. Protocol, event type, V3/V4, minimum USD, token, pool, user, NFT, and watched-only changes all rebuild one selected array.
- Focused FLOW projection/client/API regression passed as part of the six-file, 37-test run. The complete PostgreSQL suite also retained P02-04 cursor, replay, duplicate, replacement-branch, and tombstone coverage.

No event is marked finalized. `GAP-FINALITY-DEPTH` remains unresolved.
