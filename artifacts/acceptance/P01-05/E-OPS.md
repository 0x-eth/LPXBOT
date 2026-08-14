# E-OPS: PWA, Telegram adapter, cache safety, and CI

## PWA build

- `vite-plugin-pwa` 1.3.0 uses `injectManifest` to generate `manifest.webmanifest` and `sw.js` from the independent Vite production build.
- The manifest contains `name` and `short_name` `LP Bot`, `start_url` and `scope` `/`, `display` `standalone`, background `#ffffff`, theme `#171717`, and 192, 512, and maskable PNG icons.
- HTML declares `viewport-fit=cover` and a matching theme color.
- `pnpm test:pwa` builds and previews the production output on a separate local port. All four tests passed: manifest/SW activation, offline anonymous-shell fallback, obsolete cache cleanup, and sensitive/runtime response non-persistence.

## Bitmap provenance

The immutable source files and derivatives are recorded in `apps/web/public/pwa-icon-provenance.json`.

| Asset | SHA-256 |
|---|---|
| `artifacts/lpbot/2026-08-13/icon.png` | `e6db884077c7a4986d835469a44cc7031dc0fb196fd9eb8674714a1fabdd8cf9` |
| `artifacts/lpbot/2026-08-13/logo-maskable.png` | `81c9ddd38558eb05cf8a7899b0929f3a5608401725f2febbd4c965feb6cd9a71` |
| `apps/web/public/pwa-192x192.png` | `bd538549af8b293a6786c41ebc2ac674873c9176ea902428894f18be37e43c8a` |
| `apps/web/public/pwa-512x512.png` | `fd7729bfe2225fb8ee49a175f6cb90505a5f293f33ae414dcc6e544ea5c6ef5f` |
| `apps/web/public/pwa-maskable-512x512.png` | `9eb8772b005bbe06c097ee6799a299b2607c50db6c1b3a2fbda768f0e932bd04` |

The source files and complete frozen baseline tree remain unchanged.

## Service Worker policy

- Workbox precaches only build-time CSS, HTML, JavaScript, JSON, and PNG entries carrying generated revisions.
- Cross-origin requests, `/api` and `/api/**`, Authorization-bearing requests, SSE requests, and every non-GET/HEAD method are explicitly network-only.
- Runtime same-origin navigation is network-only. On network failure only, it falls back to the precached `/index.html` shell.
- No runtime API, authentication, Cookie response, SSE response, write response, user record, or navigation response is added to Cache Storage. The browser then performs a network-only session restore; offline failure renders `Connection unavailable`, not an authenticated or populated route.
- Activation deletes obsolete `lpbot-*` caches while retaining the current versioned precache.
- A waiting version produces a persistent global `新版本可用` Toast. Reload occurs only when the user invokes its action. Registration/update failure produces a persistent safe error with a real registration update or reload retry command.

## Telegram environment

- The local adapter calls optional `ready` and `expand`, synchronizes viewport and theme CSS variables, listens for `viewportChanged` and `themeChanged`, and delegates BackButton clicks to router history.
- Mount/unmount registers and removes handlers, hides the BackButton at root/login, and shows it on deeper routes.
- Missing `window.Telegram.WebApp` is a normal browser/PWA state. No external Telegram SDK script is loaded in local development, build, preview, or CI.
- CSS consumes both Telegram viewport variables and `env(safe-area-inset-*)` without requiring injected Telegram state.

## CI and operational boundary

GitHub Actions run [31800845957](https://github.com/0x-eth/LPXBOT/actions/runs/31800845957) passed for implementation commit `70fe133c1b00fffaad7d174440f585fbad668831`.

| Job | Result | Relevant gate |
|---|---|---|
| Quality | passed | format, lint, typecheck, 132 Vitest tests plus 19 governance tests, build |
| Governance | passed | frozen baseline, 196 feature IDs, P00, docs, acceptance manifests, P01-01 integrity |
| Browser | passed | Linux Chromium desktop/mobile, strict platform snapshots, axe, keyboard, responsive matrix |
| Contracts | passed | Solidity format/build and 3 Foundry tests |
| Infrastructure | passed | local services, repeatable migrations/seed, health, infra and PostgreSQL tests, cleanup |
| Security | passed | full-history Gitleaks and dependency audit |

Local Gitleaks 8.30.0 additionally scanned 250 commits and approximately 18.29 MB with no leaks. `pnpm audit:dependencies` reported no known vulnerabilities.

No target site, Telegram endpoint, external RPC, production service, production credential, transaction, or business write was contacted. P01-05 does not implement `SHELL-02..04`, `SET-01..02`, or any business page capability.

## Frozen tree integrity

| Tree | Before | After |
|---|---|---|
| Frozen reference fixture | `0b24a81889eb728477e583c43c9121fac7235113` | `0b24a81889eb728477e583c43c9121fac7235113` |
| P01-01 acceptance | `85fcccb8e9858647f5237888967607767bd85a35` | `85fcccb8e9858647f5237888967607767bd85a35` |
| P01-02 acceptance | `97fe222b38b9635b17f5ae795e5c0c84b31d258b` | `97fe222b38b9635b17f5ae795e5c0c84b31d258b` |
| P01-03 acceptance | `3ce5c7bc9d67f1f4b50c0da23085b65fe200b5f5` | `3ce5c7bc9d67f1f4b50c0da23085b65fe200b5f5` |
| P01-04 acceptance | `74719d2183628ef6982cf85cb96afbd46274ad86` | `74719d2183628ef6982cf85cb96afbd46274ad86` |
