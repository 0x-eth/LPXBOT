# P02-09 initial failures

Tests preceded each implementation slice. The durable red states were:

- Recommendation selection tests were added before `apps/api/src/recommended-pools.ts` existed and before `RecommendedPoolRow` replaced the old stats `string[]` field.
- API tests initially failed on unsupported chain and limit handling, stats-only separation, recommendation-only streaming, safe provider errors, RBAC, rate limiting, cursor validation, heartbeat, reconnect, reorg replacement, and abort propagation.
- Fake-clock stream tests initially had no immediate structured snapshot, five-second poller, payload hash deduplication, 25-second heartbeat, or cancellation cleanup implementation.
- Client tests initially rejected the required structured lane because the state was coupled to stats sequence and retained only display strings.
- Playwright first found zero `.status-pool-link` elements. The test fixture had delivered its only event to React StrictMode's intentionally cancelled first subscription; the fixture was corrected to serve the first non-cancelled connection without weakening production parsing.
- Hardening tests then demonstrated two additional red boundaries: an unknown runtime V4 protocol was selected, and an initial canonical provider failure committed HTTP 200 instead of a safe 503. Both tests passed after the protocol allowlist and pre-header initial read were implemented.
- The PostgreSQL reorg test first produced an empty recommendation because its frozen source events were liquidity changes; its local copy was converted to swaps, then split into old-branch and full replacement stages to exercise the existing canonical fee rules.
- The P02 governance test was updated before evidence creation and passed the 18/5 status count while failing four checks for the missing P02-09 manifest, Golden, prior inventory, and checksum inventory.

No frozen P02-01 through P02-08 acceptance file was edited while resolving these failures.
