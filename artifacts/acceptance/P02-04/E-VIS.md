# E-VIS

- Playwright performs an axe scan and reports no serious or critical violations for the populated flow panel.
- Desktop uses a 1440 px viewport and mobile uses a 390 px viewport. Both retain usable DEX controls, flow filters, status, pause/resume control, and event rows without horizontal page overflow.
- Darwin and the pinned Playwright Linux image each have checked visual baselines for the pools and flow views.
- Frozen acceptance captures:
  - `ui/liquidity-flow-chromium-desktop.png` (1440 x 1131)
  - `ui/liquidity-flow-chromium-mobile.png` (390 x 2391)
  - `ui/pools-ready-chromium-desktop.png` (1440 x 900)
  - `ui/pools-ready-chromium-mobile.png` (390 x 844)
