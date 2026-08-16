# E-VIS

- Playwright exercised the label chip, `+N`, expanded reasons, hidden preference, keyboard operation, focus return, and table geometry at 1440x900 desktop and 390x844 mobile viewports.
- Axe reported no serious or critical violations on either viewport.
- Root and dialog overflow assertions passed. Long reason codes, Decimal observations, rule versions, and timestamps remain within the responsive dialog.
- The inspected full-page captures are `ui/pool-labels-chromium-desktop.png` (1440x1673) and `ui/pool-labels-chromium-mobile.png` (390x2867).
- Unlabeled and preference-hidden rows contain neither a label chip nor a layout placeholder.
- The final single-worker full regression passed 138 tests with four project-conditional skips and no failures across the desktop and mobile projects.
