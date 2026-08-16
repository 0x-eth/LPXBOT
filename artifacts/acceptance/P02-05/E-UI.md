# E-UI

- `/pools` displays inflow, outflow, valued net, event count, unique address count, and valuation completeness for the current loaded window after all UI filters.
- The real-time/address segmented view is single-pane below 1100 px and side-by-side at wide desktop widths. Radio groups support arrow-key selection and roving focus.
- Address rows show personal-or-shared text labels, watched state, valued net, event count, deduplicated pool count, recent time, complete/partial/idle state, and only filter/copy/BscScan/edit/watch actions.
- Watched-only mode retains watched addresses with no selected events as `idle`. Partial addresses stay separated from complete net results.
- Remark save/delete/watch operations update optimistically. An operation-ID reducer restores the exact prior row on failure, preserves the user's trimmed draft, ignores stale failures, and protects pending optimistic values from stale list refreshes.
- Loading, empty, error/retry, stale, reconnecting, paused/resumed, partial, and idle-watched states are covered by Vitest and Playwright.
- P02-05 Playwright passed all 6 desktop/mobile tests, including keyboard focus, text-only rendering of an HTML-looking shared label, optimistic failure rollback, retry states, and axe serious/critical checks.
