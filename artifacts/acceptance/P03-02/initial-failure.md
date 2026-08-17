# P03-02 Initial Failure Record

Red tests observed during the slice included:

- `/monitors` redirected to `/pools` and had no monitor list/editor.
- CRUD, idempotency, revision, evaluator, candidate, watermark, and Outbox persistence contracts were absent.
- The first editor used a select instead of the frozen five-option radio group.
- Transaction counts above `Number.MAX_SAFE_INTEGER` remained submittable.
- A running monitor could remove every enabled condition.
- Cross-window metric input matched a monitor with another configured window.
- Paged mutations replaced the global 5/7 aggregate with current-page counts.
- A sixth retryable Outbox failure entered retry-wait instead of becoming dead.

Each item was reproduced at a public API, pure-function, PostgreSQL repository, or browser boundary before the corresponding green change.
