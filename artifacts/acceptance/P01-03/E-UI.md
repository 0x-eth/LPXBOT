# E-UI: Telegram login workflows

## Mini App flow

- The browser adapter reads `Telegram.WebApp.initData` only from the in-memory Telegram runtime and calls `ready()` when data is available.
- The client enters `authenticating` with method `telegram-mini-app`, submits once to `POST /api/auth/me`, and converges to the protected shell or a server-authoritative blocked state.
- Outside a Mini App runtime the control is disabled and does not simulate a successful login.

## Bot flow

- The login page creates a real one-time link, exposes the `https://t.me/...` action, polls with capped exponential backoff, and provides explicit cancellation.
- Polling has both an attempt limit and server expiry limit. Timers and in-flight requests are closed with `AbortController` on success, cancellation, timeout, replacement, or disposal.
- Creation and polling failures render a retryable error. Retry either resumes the still-valid intent or creates a new one after expiry.
- The wallet login control is absent from this work item; there is no placeholder action that produces a false success.

## Browser boundaries

- The Bot token and Mini App `initData` remain in memory only. Playwright verifies empty `localStorage` and `sessionStorage` after login.
- `BroadcastChannel` sends exactly `{ type: "auth-complete" }`. It sends no login token, session credential, user ID, or profile field.
- A second page restores the shared HttpOnly-cookie session after receiving that credential-free message.

## Browser verification

`pnpm test:e2e` passed 28 tests across:

- Chromium desktop at 1440 x 900.
- Chromium mobile at 390 x 844.
- Mini App keyboard activation and mobile viewport behavior.
- Bot link creation failure followed by successful retry.
- Two-page BroadcastChannel convergence.
- Pending, rejected, banned, maintenance, region, and forbidden route states.
- axe analysis with no serious or critical violations in asserted authentication states.
- Browser page-error, console-error, and failed-request smoke checks.

Evidence level is `local-fixture-verified`. Live Telegram execution was not performed.
