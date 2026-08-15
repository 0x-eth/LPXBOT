# E-UI: Route-state and interaction closeout

Evidence level: `local-fixture-verified`.

The complete matrix is [route-state-matrix.json](./route-state-matrix.json). The nine ordinary-user no-funds routes are:

1. `/tasks/running`
2. `/tasks/paused`
3. `/tasks/stopped`
4. `/pools`
5. `/strategies`
6. `/activity`
7. `/wallets`
8. `/developer`
9. `/settings`

Each route was exercised with local `loading`, `empty`, `error` and `forbidden` fixtures on desktop and mobile. These fixtures contain no business records and are stripped from production by `import.meta.env.DEV`.

The closeout test found that the route catalog did not expose every state and that booting/authenticating pages lacked an `h1`. The retained failing run is in [initial-failure.md](./initial-failure.md). The minimal fix adds a development-only route-state gate and one visually hidden semantic heading to each transient authentication page.

User and Pro navigation expose the six primary destinations and settings, but not users or chain management. Admin adds users and chain management. Existing shell, auth-state, settings, wallet-login and chain-management tests cover keyboard order, dialog Escape/focus return, confirmation focus, preference reorder and visible focus.

Every matrix state has exactly one `h1`. Serious and critical axe violations are zero after the dark-theme contrast repair.
