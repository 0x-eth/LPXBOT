# E-VIS

- Playwright exercised the P02-06 search, grouping, and column surfaces at 1440x900 desktop and 390x844 mobile viewports.
- Axe reported no serious or critical violations on the expanded Token-search group surface.
- Root overflow assertions passed on both viewports. Search controls, group toggles, table scrolling, and the column dialog remain operable without incoherent overlap.
- The checked captures were produced by the dedicated P02-06 test after Token search returned three canonically grouped pools and the group was expanded.
- GitHub Actions Browser job `95159507569` executed the full 128-test suite in the pinned Playwright 1.62.1 Noble container on Linux ARM64 and passed 124 with 4 declared skips. Its 12 real steps include container initialization and test execution; the failure-only upload step was skipped by condition.

Frozen local captures:

| Capture | Viewport |
| --- | ---: |
| `ui/pool-discovery-chromium-desktop.png` | 1440x900 |
| `ui/pool-discovery-chromium-mobile.png` | 390x844 |
