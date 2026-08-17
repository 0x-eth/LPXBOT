# P03-04 UI Evidence

`/monitors` includes a dedicated `Notification History` tab beside monitor management.

- Filters cover public status, monitor, start time, and end time. Every filter starts a fresh stable first page; `Load more` appends cursor results while removing duplicate delivery IDs.
- Desktop renders a scan-oriented table and detail drawer. Mobile renders the same fields in a single-column list and uses the same drawer.
- Summary and detail views show attempts, next retry time, stable error code, delivery time, monitor/destination snapshots, pool, condition summary, and window.
- UI states cover loading, empty, ready, pending, sending, retrying, delivered, failed, service error, retry, and loading-more.
- The tab list supports ArrowLeft/ArrowRight/Home/End roving keyboard navigation. Detail close restores focus to the originating row action.
- The strict client rejects unknown or missing response fields and does not accept sensitive delivery fields.

Focused Playwright passed 3 scenarios with 1 intentional mobile duplicate-state skip across the desktop and 390px mobile projects.
