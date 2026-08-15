# E-UI: `/pools` tracer page

Evidence level: `local-fixture-verified` only.

`/pools` now renders the usable market tracer rather than generic placeholder content. It provides:

- a keyboard-operable segmented control for 1/5/15/30/60 minute windows;
- explicit loading, empty, error, stale, reconnecting, and ready states;
- a connection status with icon and accessible status name;
- a BSC table containing pool, protocol, Fees, Volume, TVL, Txs, and FDV;
- exact decimal strings for state and sorting, bounded HALF_EVEN display formatting, original values in cell titles, and compact K/M/B values on mobile;
- no displayed or synthesized aTVL value.

The slice does not add DEX filters, advanced filters, grouping, column drag, comparison, candles, tick liquidity, context actions, blocking, or liquidity-flow views. Those feature IDs remain planned.

Screenshots:

- [Desktop ready state](ui/pools-ready-chromium-desktop.png)
- [Mobile ready state](ui/pools-ready-chromium-mobile.png)
