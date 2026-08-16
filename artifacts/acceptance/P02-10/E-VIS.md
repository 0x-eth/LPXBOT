# E-VIS

- `ui/candle-tick-chromium-desktop.png` is the 1440x900 desktop capture after the focused rendering, keyboard, focus, layout, and axe assertions.
- `ui/candle-tick-chromium-mobile.png` is the 390x844 narrow-screen capture after the same applicable assertions.
- The chart and histogram have stable responsive dimensions. Loading text, controls, legends, and dynamic data do not resize the surrounding pool columns.
- On mobile, the wide pool table remains horizontally scrollable while the expanded detail is sticky to the table viewport's left edge. The detail stays at a non-negative viewport x-coordinate and does not cover the following row.
- Playwright exercises expand/collapse, tab keys, focus visibility, periodic refresh, SSE refresh, cancellation, state presentations, and desktop/mobile overflow.
- Axe reports no serious or critical violations in the expanded Candle and Tick views on desktop and mobile.
