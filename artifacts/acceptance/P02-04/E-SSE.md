# E-SSE

- The frozen wire event names remain `backfill` and `liquidity-add`. Internally they map to versioned `liquidity.backfill` and `liquidity.event` envelopes; heartbeats map to `heartbeat` and are emitted as SSE comments.
- A first connection receives a bounded historical backfill at a captured watermark, then follows outbox sequence order. `Last-Event-ID` is resolved against a retained durable cursor and replay is strictly after that sequence.
- The browser client retains the latest SSE `id` for reconnect while independently advancing `since` with the maximum record `ts`. Stable record IDs suppress duplicate rows.
- Reorg records are versioned tombstones. They remove the referenced row and are replayed before replacement-branch events; reverted rows are never rendered as ordinary events.
- The endpoint sends `retry: 3000`, disables proxy buffering and caching, cleans up on close/error, waits for drain, and aborts clients whose pending write buffer exceeds 1 MiB.
- The public stream is rate limited to 60 connection requests per 60 seconds by default. The limit is configurable only with positive integers.
- Focused SSE tests are `tests/liquidity-flow-api.test.ts`, `tests/liquidity-flow-client.test.ts`, `tests/market-pools-api.test.ts`, and `tests/pools-stream-client.test.ts`.
