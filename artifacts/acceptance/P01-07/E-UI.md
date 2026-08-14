# E-UI: Administrator chain management

Evidence level: `local-fixture-verified`.

## Settings behavior

- `/settings` renders `站点运营 / 链管理` only for a server-restored admin session.
- user and pro do not render the entry, and direct management writes remain 403.
- The modal is a Radix Dialog with a labelled close command and focus restoration to its trigger.
- Access modes use a keyboard-operable segmented radio group. The default chain cannot select `off`; incomplete chains cannot select `pro` or `all`.
- The dialog states the effects of off, Pro, and all, and displays chain name, chain ID, default status, readiness, and nullable active-position count.
- Missing activity data renders `活动仓位不可用`; it is never converted to zero.
- Changes render a before/after preview and require a reason before save.
- P01-05 `ConfirmDialog` is reused, with cancel focused initially.
- Loading, empty, error, retry, saving, conflict, reload, success, and rollback paths are covered.
- Conflict and generic failures render stable client text and never render server-private error messages.

## Browser verification

The full suite passed 73 tests with 3 intentional cross-project skips across Chromium desktop 1440x900 and mobile 390x844. The chain-management subset passed 8/8. The test also switches the open dialog to 320x844 and asserts no document overflow.

Keyboard mode changes, confirmation focus, dialog focus return, and axe scans are included. Serious and critical axe violations were zero in every chain-management scan.

Screenshots:

- [Desktop chain management](ui/chain-management-chromium-desktop.png)
- [Mobile chain management](ui/chain-management-chromium-mobile.png)

P01-05 shell behavior, P01-06 settings behavior, and P01-06 visual snapshots passed in the same full run. One generated P01-06 `actual` image was restored from the requested start commit after the run so historical acceptance evidence remained unchanged.
