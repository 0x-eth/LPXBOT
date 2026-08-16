# E-UI

- `/pools` provides an explicit Token/池 segmented search, so a 20-byte value is never interpreted simultaneously as both a Token and a V3 pool address.
- Token mode calls the by-token API. Pool mode filters the current real-time list by an exact canonical V3 `poolAddress` or V4 `poolId`. Search mode and value serialize as `pool_search_mode` and `pool_search` URL parameters.
- Submit, refresh, clear, navigation restore, and return-to-live-list behavior are covered. Starting a new Token search aborts the previous request and increments a generation; a late response cannot replace the current result.
- Search renders loading, ready, no-results, invalid, error, and reconnecting states. Missing Token symbols stay visibly unknown rather than becoming addresses.
- Canonical Token groups render one stable header row and a `+N` expand control. Expansion reveals members in current stable order and remains valid across stream changes.
- The column dialog covers all eight columns: pool, protocol, fees, volume, tvl, txs, fdv, and actions. Pool/actions are always visible and locked to the first/last positions.
- Middle columns support pointer drag, keyboard up/down buttons, visibility toggles, and deterministic reset. Save persists through the existing preferences endpoint; reload and relogin restore the same layout.
- Save failure retains the dialog error and restores the exact prior saved table. A revision conflict refreshes the authoritative server layout and preserves a coherent next-edit state.

The dedicated Playwright file passes three scenarios in both desktop and mobile projects as part of the full 124-pass, 4-skip browser run.
