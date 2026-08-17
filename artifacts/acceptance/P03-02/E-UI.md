# P03-02 UI Evidence

`/monitors` is a real authenticated route rather than a redirect. It provides the monitor list, disabled-first creation, editing, enable/disable, delete confirmation, global enabled/total count, and revision-conflict recovery while preserving a user's unsaved draft.

The editor supports five keyboard-operable window radio segments, up to 16 AND conditions, exact transaction-count input bounds, Han Token and Hook exclusions, and immutable pool identity. Active TVL and Fee/aTVL remain visible as disabled unavailable options and cannot be submitted.

Loading, empty, ready, not-ready, stale, conflict, and error/retry states are covered. The P02-11 `create-monitor` intent opens the editor with only `poolKey` prefilled; it does not save or enable a monitor.

Focused Playwright result: 5 passed across chromium desktop/mobile and 3 desktop-only cases were intentionally skipped on mobile. P02-11 and shell regression coverage passed 17 with 3 intentional device skips.
