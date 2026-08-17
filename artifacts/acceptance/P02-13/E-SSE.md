# P02-13 SSE Evidence

- A configured statistics lane reads a snapshot before hijack and writes `snapshot` as its first statistics event.
- Subscription starts from that exact snapshot sequence, so an update committed between snapshot and polling is observed.
- Scope heads are durable and strictly increase only when public task counts change. Equal source payloads are idempotent; equal counts at a newer source revision do not create a wire update.
- Polling may skip intermediate versions but emits the latest complete `taskCounts` patch, preventing clients from retaining an intermediate state.
- With no changed content, the production provider emits a heartbeat every 25,000 ms with `sequence: null`.
- Provider abort ends its observable query wait and timer immediately. A process restart rereads the persistent scope sequence; reconnect cannot regress it.
- Statistics and recommendation producers run as independent lanes behind ordered chunk writes; P02-09 cursor, deduplication, and cadence behavior remains covered.

The wire remains the P01-06 `ShellStatsEvent` shape. No write or mutation route was added.
