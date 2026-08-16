# E-UI

- Each pool row has a single expand/collapse control. Opening another pool closes the prior detail and aborts its reads; a stream tombstone also closes the active row.
- The expanded row contains keyboard-operable `K 线` and `Tick 流动性` tabs. Arrow keys, Home, and End move tab selection and focus using the ARIA tabs pattern.
- Candle controls select `1m`, `5m`, `15m`, `1H`, `4H`, and `1D`; Tick controls select range 5 through 50. The selected pool identity and catalog tick spacing remain explicit request parameters.
- Candles render with `lightweight-charts@5.0.9`. API OHLC remains exact Decimal text; raw integer volume is deterministically scaled only for the library's finite canvas coordinate range, with the display unit stated.
- Tick liquidity uses a fixed-size histogram and an accessible data table containing tick, liquidityNet, price0, and price1 values.
- Loading, empty, error, stale, unsupported, and invalid states are explicit. Stale data remains visible with a stale marker while refresh is attempted.
- The detail occupies a dedicated table row and does not alter data-column widths. Its inner layout is bounded and horizontally safe on narrow screens.
