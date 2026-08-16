# E-UI

- `/pools` exposes one DEX selector for PancakeSwap V3, Uniswap V3, PancakeSwap V4, and Uniswap V4. Snapshot and stream URLs use its canonical sorted, deduplicated selection.
- The flow panel supports all/add/remove/create, all/V3/V4, minimum USD, token, pool, user, and NFT filters. Every filter is clearable and URL serializable.
- A positive minimum USD excludes records whose USD value is `null`; the UI displays unknown NFT, USD, token amount, and range data as unknown rather than zero.
- The connection model exposes `loading-backfill`, `live`, `paused-hidden`, `empty`, `error`, `stale`, and `reconnecting` without discarding the last usable rows.
- Pausing buffers incoming records. Resume applies the same stable-ID dedupe, tombstone handling, and deterministic sort as live delivery.
- Playwright covers desktop/mobile layouts, URL round trips, filters, empty/unknown values, keyboard pause/resume, focus retention, and all seven connection states in `tests/e2e/liquidity-flow.spec.ts`.
