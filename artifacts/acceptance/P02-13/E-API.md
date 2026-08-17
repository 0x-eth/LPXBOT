# P02-13 API Evidence

- `GET /api/stats` remains authenticated, returns the existing success envelope, and sets `Cache-Control: no-store`.
- `GET /api/stats/stream` authenticates, validates query/RBAC, resolves any Telegram filter, records its audit summary, and reads the initial statistics snapshot before SSE hijack.
- A user or pro reads only their internal user scope. An administrator without `user_id` reads global scope. An administrator with `user_id=<decimal Telegram ID>` reads the UUID resolved through `telegram_identities`.
- Unknown Telegram identities return 404 `STATS_USER_NOT_FOUND`; non-admin filters return 403 `FORBIDDEN`. Both occur before an SSE content type or provider subscription is opened.
- Missing provider, unready projection, and corrupt/failed storage reads return retryable 503 `STATS_UNAVAILABLE` without leaking storage details.
- In a combined statistics/recommendation stream, the statistics snapshot is first. Recommendation eligibility remains tied to the signed-in session user's blocklist, not the administrator's target user.

Focused result: `tests/stats-sse-api.test.ts` and `tests/recommended-pools-api.test.ts` passed as part of the 42-test focused run.
