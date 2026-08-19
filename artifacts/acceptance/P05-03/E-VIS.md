# E-VIS

Screenshots were captured from deterministic browser route fixtures after the complete keyboard flow. Evidence capture hides only unrelated wallet sections and fixed shell navigation so full-page stitching cannot cover the target panels; normal runtime layout is unchanged.

| File | Dimensions | Coverage |
|---|---:|---|
| `E-VIS/swap-pricing-chromium-desktop.png` | 1440 x 900 | Dense six-control quote row, exact result facts/route, three-column cost input, and hidden ledger observation. |
| `E-VIS/swap-pricing-chromium-mobile.png` | 390 x 1958 | Single-column controls, wrapped route addresses, exact base-unit facts, import fields, and non-overlapping action state. |

Both captures preserve readable labels and exact values without horizontal overflow. Playwright separately checks `documentElement.scrollWidth <= innerWidth` and serious/critical Axe violations before evidence-only capture styling is applied.
