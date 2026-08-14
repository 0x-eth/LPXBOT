# P01-06 initial failing tests

- Evidence level: `local-fixture-verified`.
- Pre-test repository anchor: `d950cad283a6731475df33ed35cc07fe636a9b52`.
- Red-test commits: `62cc50f` through `8a61597` (repository auto-sync).
- Test seams: authenticated HTTP API, real PostgreSQL, authenticated SSE, browser theme/navigation/settings UI, strict Playwright screenshots.

## Unit and API red state

Command:

```text
pnpm exec vitest run tests/user-preferences-api.test.ts tests/stats-sse-api.test.ts tests/shell-stats-client.test.ts tests/web-theme.test.ts
```

Result: failed as expected. `/api/user/preferences`, `/api/stats`, and `/api/stats/stream` returned `404`; `apps/web/src/shell-stats.ts` and `apps/web/src/theme.ts` did not exist. Seven executable API assertions failed and two client/theme suites could not load their not-yet-implemented public modules.

## PostgreSQL red state

Commands:

```text
pnpm infra:up
pnpm db:migrate
pnpm test:postgres
```

Result: failed as expected. The existing three PostgreSQL suites passed; both new preference tests failed because the real database had no `user_preferences` relation or columns.

## Browser and visual red state

Command:

```text
LPBOT_PLAYWRIGHT_PORT=43175 pnpm exec playwright test tests/e2e/preferences-shell.spec.ts --project=chromium-desktop --grep 'applies cached theme|visual contract'
```

Result: failed as expected. The document had no `data-theme` on the initial frame and `/settings` had no `界面` heading, so the visual contract could not reach its first screenshot comparison. Port `43175` was used because an existing process already owned the default local Playwright port; that process was left untouched.

No target site, Telegram service, external RPC, market service, production API, transaction, signature, or broadcast was contacted.
