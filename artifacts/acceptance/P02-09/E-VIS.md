# E-VIS

- `ui/recommended-pools-chromium-desktop.png` is the inspected 1440x900 desktop capture.
- `ui/recommended-pools-chromium-mobile.png` is the inspected 390x844 narrow-screen capture.
- The status bar remains 32 px on desktop and 34 px on mobile across loading, ready, empty, unavailable, reconnecting, stale, and dynamic fee replacement states.
- Playwright asserts no document-level horizontal overflow, no vertical status-bar overflow, and no height change when Fees update from `$12.50` to `$99.00`.
- The first recommendation receives programmatic keyboard focus, exposes a visible focus state through the existing link control, and activates with Enter.
- Axe reports no serious or critical violations on both desktop and mobile recommendation views.
