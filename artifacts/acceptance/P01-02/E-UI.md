# E-UI: Auth state and route-guard evidence

## State coverage

The web client implements and exercises these states:

| State | Server result | Route/result | Evidence level |
|---|---|---|---|
| booting | request pending | accessible busy state | local-fixture-verified |
| anonymous | 401 | `/login` | local-fixture-verified |
| active user | 200 | protected task route | local-fixture-verified |
| active pro | 200 | protected task route; `/users` denied | local-fixture-verified |
| active admin | 200 | `/users` allowed | local-fixture-verified |
| pending | 403 `ACCOUNT_PENDING` | `/blocked` | local-fixture-verified |
| rejected | 403 `ACCOUNT_REJECTED` | `/blocked` | local-fixture-verified |
| banned | 403 `ACCOUNT_BANNED` | `/blocked` | local-fixture-verified |
| maintenance | 503 `MAINTENANCE` | `/maintenance` | local-fixture-verified |
| region blocked | 403 `REGION_BLOCKED` | `/blocked` dedicated region state | local-fixture-verified |
| forbidden | 403 `FORBIDDEN` | protected data replaced by permission state | local-fixture-verified |

## Browser verification

`pnpm test:e2e` passed 22 Playwright tests across:

- Chromium desktop at 1440 x 900.
- Chromium mobile at 390 x 844.
- Route redirects and admin-only `/users` behavior.
- A later 401 clearing the in-memory `SessionView` and navigating to `/login`.
- A later generic 403 replacing protected data with a forbidden state.
- Keyboard navigation through the protected navigation.
- axe analysis with no serious or critical violation in each asserted auth state.
- Browser console, page-error, and failed-request smoke checks.

The page intentionally remains a minimal auth/RBAC foundation. Telegram, Bot, and wallet login adapters and the complete application-shell visuals are outside P01-02.
