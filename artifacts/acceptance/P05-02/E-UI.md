# E-UI

The `/wallets` route now contains three unframed read sections:

- Positions: `loading`, `empty`, `ready`, `partial`, `stale`, `quarantined`, and `error`.
- Helper: `undeployed`, `active`, `degraded`, `superseded`, and `residual`, plus request loading/error handling.
- Residuals: `loading`, `empty`, `scanning`, `ready`, `partial`, and `error`.

Only refresh and re-scan commands are exposed. No collect, decrease, deploy, upgrade, sweep, rescue, signing, or fund-operation control is rendered. Position values display exact base units, canonical block, Registry version, V3/V4 identity, approval state, and quarantine reasons.

The P05 Playwright suite passed 4 tests across `chromium-desktop` and `chromium-mobile`. It covers every state, keyboard activation, focus retention after refresh/re-scan, serious/critical Axe violations, horizontal overflow, exact platform identity, and absence of execution controls. The adjacent P04-06 fixture was extended with strict empty responses for the three new reads; its 6 desktop/mobile tests pass without weakening unknown-request detection.
