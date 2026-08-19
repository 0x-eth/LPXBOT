# E-VIS

Evidence was captured with `LPBOT_CAPTURE_P05_02=1` from deterministic browser route fixtures. The crop spans exactly the position, Helper, and residual sections; fixed shell navigation is hidden only during evidence capture so it cannot obscure the long mobile region.

| File | Dimensions | Coverage |
|---|---:|---|
| `E-VIS/position-helper-ready-chromium-desktop.png` | 1440 x 734 | Three-column exact-value layout, canonical snapshot, active Helper identity, and residual token. |
| `E-VIS/position-helper-ready-chromium-mobile.png` | 390 x 1146 | Stacked facts, wrapped hashes/addresses, full residual row, and non-overflowing refresh controls. |

Both images show platformId 1 as Uniswap V3. PNG dimensions and minimum byte size are frozen by `tests/governance/p05-02-completion.test.mjs`. The same Playwright flow verifies keyboard focus, Axe, and `documentElement.scrollWidth <= innerWidth` at both viewports.
