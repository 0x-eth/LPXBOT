# E-SSE: Replaceable shell statistics provider

## Scope and evidence level

- Work item: `P01-06`.
- Feature ID: `SHELL-02`.
- Evidence level: `local-fixture-verified`.
- P01-01 observed the status-bar field names and recorded the stats endpoints in visible developer documentation. No live stats stream or market value was replayed for P01-06.

## Server behavior

- `ShellStatsProvider` separates shell transport from any future data source through `getSnapshot({ userId })` and `subscribe({ userId, afterSequence, signal })`.
- `GET /api/stats` requires a server session, returns `Cache-Control: no-store`, and preserves null values rather than manufacturing zeros.
- `GET /api/stats/stream` authenticates before hijacking the response. Anonymous requests return `401` and never open a provider subscription.
- The stream sends `retry: 1000`, then a first `snapshot`, followed by strictly increasing `update`, `rec_pools_snapshot` and `heartbeat` events. Each event carries an SSE `id`, named `event`, JSON `data`, timestamp and sequence.
- Duplicate or older provider sequences are discarded. The response disables caching and proxy buffering. Closing the HTTP connection aborts the provider signal and ends the stream.
- With no configured provider, the API returns a retryable `503 STATS_UNAVAILABLE`; normal local startup does not contact an RPC, market or indexer service.

## Client behavior

- The browser client parses SSE frames split across arbitrary chunks, normalizes CRLF, validates every event shape and merges nested gas/task patches without erasing prior fields.
- Repeated incremental sequences are ignored. A reconnecting snapshot may re-establish the current connection state.
- EOF, invalid responses and network errors mark a previously connected state disconnected. Reconnect delay grows exponentially from 1 second to a 30-second cap in production; the deterministic test observes `250ms`, then `500ms` with a `1000ms` cap.
- Removing the final subscriber aborts the active fetch, cancels the stream reader and prevents further reconnects.
- Disconnected, absent and null values render `不可用` or `--`; they never render false `在线` or numeric zero.

## UI fixture

- The deterministic browser fixture supplies sequence 20 with online, one running/paused/stopped task, two recommendation labels, Base/ETH gas, FPS and ping.
- Desktop renders the fixed bottom status row. Mobile retains the fixed bottom navigation and consumes only the stable task count badge; it does not add a competing status row.
- A deliberately empty persistent SSE fixture keeps P01-05 strict shell screenshots in their original no-status state and exercises cleanup without a failed network request.

## Results

- `tests/stats-sse-api.test.ts`: 3/3 passed for authenticated snapshot, ordered event stream and anonymous rejection.
- `tests/shell-stats-client.test.ts`: 3/3 passed for merge/sequence handling, unavailable rendering, split-frame parsing, disconnect, bounded backoff and cleanup.
- `pnpm test:e2e`: 65 passed with 3 intentional project skips; desktop and mobile status assertions passed.

All values came from deterministic local fixtures. P01-06 does not implement P02 indexers, market statistics or a real gas source.
