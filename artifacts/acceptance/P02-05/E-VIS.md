# E-VIS

- Darwin Playwright passed the P02-05 1440x900 desktop and 390x844 mobile projects with dedicated full-page snapshots for the statistics/address surface.
- The pinned `mcr.microsoft.com/playwright:v1.62.1-noble` image built workspace dependencies and passed 6 selected desktop/mobile visual tests. Linux baselines are stored beside the Darwin baselines under the three E2E snapshot directories.
- Axe reported no serious or critical violations. Root overflow checks passed at 390x844 and 1440x900. Horizontal table regions are keyboard focusable and have accessible names.
- Visual inspection confirmed that partial values are identified, literal shared-label markup is rendered as text, address operations remain usable, and desktop/mobile content does not overlap incoherently.

Frozen local captures:

| Capture | Pixels |
| --- | ---: |
| `ui/liquidity-insights-chromium-desktop.png` | 1440x1355 |
| `ui/liquidity-insights-chromium-mobile.png` | 390x2845 |
| `ui/liquidity-flow-chromium-desktop.png` | 1440x1352 |
| `ui/liquidity-flow-chromium-mobile.png` | 390x2838 |
| `ui/pools-ready-chromium-desktop.png` | 1440x900 |
| `ui/pools-ready-chromium-mobile.png` | 390x844 |
