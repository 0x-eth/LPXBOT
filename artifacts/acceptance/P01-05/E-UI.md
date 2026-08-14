# E-UI: Responsive application shell and global feedback

## Scope

- Work item: `P01-05`.
- Feature IDs: `SHELL-01`, `SHELL-05`, `SHELL-06`.
- Evidence level: `local-fixture-verified`.
- Viewports: desktop 1440 x 900, mobile 390 x 844, plus width checks at 320, 390, 768, 1024, and 1440 pixels.

## Application shell

- Desktop uses the P01-01 live-observed horizontal top navigation. Mobile uses a fixed six-track bottom navigation.
- Both navigation surfaces expose the Chinese labels `任务`, `池子`, `策略`, `日志`, `钱包`, and `聊天室`. Fixed grid tracks and reserved badge slots prevent dynamic indicators from resizing the layout.
- Ordinary and Pro sessions have no management link. Admin sessions receive one icon-only `管理` link to `/users`; the API-backed route guard remains authoritative.
- Refresh, notifications, settings, account, logout, and management use Lucide icons with accessible names, native titles, and visible hover/focus tooltips. No duplicate hand-authored SVG was added.
- The chat entry opens a Radix Dialog recent-chat drawer. The fixture displays `暂无最近聊天`, contains no message nodes, closes with Escape, and returns focus to the invoking desktop or mobile trigger.
- `/`, `/all`, `/all/:status`, and `/monitors` preserve the observed compatibility redirects. `/tasks/*`, `/pools`, `/strategies`, `/activity`, `/wallets`, `/developer`, `/settings`, and `/users` retain stable route outlets.
- Unimplemented business routes render an explicit local empty fixture and no business records. The P01-04 wallet login and settings workflow remains operational.
- The shell reserves a fixed 24-pixel desktop status row without rendering online, task, gas, FPS, ping, or other `SHELL-02` data.

## Global feedback

- `FeedbackController.show`, `dismiss`, and `startTask` form the shared Toast and long-task interface. The default queue is bounded at four records, `dedupeKey` updates an existing record, transient records auto-close, and progress records remain persistent until explicitly completed or dismissed.
- Success, information, and progress feedback use polite status regions. Error feedback uses `role=alert`. Actions reject into a fixed safe retry message rather than exposing exceptions.
- `ConfirmDialog` uses Radix Alert Dialog for modal semantics, background suppression, Escape handling, focus trapping, and focus restoration. Dangerous wallet removal initially focuses Cancel; Tab cycles through Cancel and Confirm.
- The P01-04 login-wallet removal flow now uses the shared confirmation component and reports success through the shared feedback controller.
- API and route failures map to fixed safe text. Tests inject server messages containing fixture internals and verify that raw exceptions, request bodies, and tokens do not enter the rendered UI.
- Route recovery is executable: request errors rerun session restoration, and the route error boundary removes the local failure fixture before replacing the current URL.

## Responsive and accessibility verification

- Every rendered route has exactly one programmatic `h1`; localized visible text is paired with an accessible English name where prior P01 assertions require it.
- The active route link sets `aria-current=page` on desktop and mobile.
- The complete admin focus order is asserted with Tab on both layouts. Drawer and danger-dialog Escape, focus return, initial focus, and focus-loop behavior are asserted separately.
- Axe reports no serious or critical violations in the asserted shell width matrix.
- At 320, 390, 768, 1024, and 1440 pixels, Playwright observed no root overflow, header action overflow, unequal navigation tracks, or content covered by the mobile navigation.
- Mobile shell height and padding include `env(safe-area-inset-top)` and `env(safe-area-inset-bottom)`; content reserves the complete bottom-navigation height.

## Browser result

`pnpm test:e2e` passed 53 Chromium tests across desktop and mobile. One mobile-project instance of the desktop-only five-width matrix is intentionally skipped; the matrix itself passed in the desktop project. The run covers authentication regressions, RBAC, complete navigation focus order, responsive/axe checks, the recent-chat drawer, safe retries, Telegram lifecycle handling, and the P01-04 wallet settings dialog.

No target site, Telegram service, external RPC, production API, or fabricated business dataset was used.
