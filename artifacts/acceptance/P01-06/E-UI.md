# E-UI: Settings, theme, navigation and live shell state

## Evidence classification

| Level | Claim used by P01-06 |
|---|---|
| `live-observed` | P01-01 visibly observed the light settings layout, light/dark/system controls, accent swatches, grid/list, toggles, sortable navigation, ordinary-user omission of management and the desktop status-bar field set. |
| `frozen-bundle-candidate` | The unchanged P01-01 bundle supplied candidate preference names and a candidate `GET /api/user/preferences` shape. These are not treated as measured network facts. |
| `local-fixture-verified` | Dark/system rendering, pre-paint bootstrap, custom-color contrast, persistence, PATCH/concurrency, navigation mutation, SSE values, error states and all browser interactions implemented here. |

## Interface settings

- `/settings` retains the existing page shell and P01-04 login-wallet section. The new first section is `界面`, matching the observed light desktop/mobile composition.
- Theme uses a three-option segmented control. Task view uses grid/list segmented controls. Presets use color swatches, booleans use switches, and navigation uses a sortable list with icon move buttons.
- The section covers theme, accent, custom accent, task view, pool panel, hot-pool recommendation, scan entry and navigation order/visibility. The task and pool empty fixtures consume typed task-view/panel attributes and do not invent business records.
- Initial GET exposes `正在加载`; saves expose `正在保存`; confirmed state exposes `已同步`; successful saves use the P01-05 global success Toast.
- Invalid custom color uses an inline `role=alert`. Server/network failure rolls the optimistic value back and uses a fixed safe global error Toast with a working retry action. Initial preference GET failure exposes an in-section retry without polluting strict P01-05 shell screenshots.

## Theme and accent behavior

- The HTML head reads only the three cached theme fields and applies resolved theme, semantic CSS variables, `color-scheme` and `meta[name=theme-color]` before the application script loads.
- `system` subscribes to `prefers-color-scheme` changes and updates in place. Server loading then replaces the bootstrap cache with the authoritative preference.
- Semantic variables cover background, surfaces, borders, text, muted text, hover, danger, accent, accent foreground and focus ring across shell, settings and feedback.
- The 11 observed presets are neutral, blue, violet, green, orange, red, cyan, pink, indigo, amber and teal. Custom input accepts only `#RRGGBB` and normalizes uppercase.
- Unit tests assert at least 4.5:1 accent/foreground contrast and 3:1 focus/background contrast for every preset in light and dark, including a near-white custom accent.
- The active theme synchronizes document `color-scheme`, theme-color meta and the PWA defaults. Dark rendering and persistence remain `local-fixture-verified`, not promoted to live observation.

## Navigation behavior

- Server-normalized `navConfig` drives both desktop top navigation and mobile bottom navigation.
- Every row has visible up/down buttons. Focusing a row and pressing `Alt+ArrowUp` or `Alt+ArrowDown` performs the same command, so drag-and-drop is not required.
- Hidden items disappear from both surfaces and saved order survives reload and a second browser context. Restore default writes the contract default through the same optimistic/server flow.
- The task switch is checked and disabled. Management is not part of `navConfig` and remains role-derived.
- CSS reserves equal tracks and badge slots so item count, order and task badges do not resize labels or shift the shell.

## Status presentation

- Desktop renders online state, running/paused/stopped counts, recommendation labels, Base/ETH gas, FPS and ping in the fixed bottom row.
- Mobile keeps the fixed bottom navigation and shows only a stable task badge. It does not render a second bottom status bar.
- Missing fixture data leaves the historical reserved row empty. Once a valid null or disconnected state exists, the UI displays `不可用`/`--`, never a fabricated zero or online state.

## Browser and accessibility result

- `pnpm test:e2e`: 65 passed; 3 desktop-only matrix cases were intentionally skipped in the mobile project and ran successfully in desktop.
- Playwright covers light, dark, system-light, system-dark, teal, blue and custom accents; optimistic save, rollback/retry, refresh and second-context persistence; desktop 1440x900 and mobile 390x844.
- The boundary matrix at widths 320, 768 and 1024 reports no root/control overflow. P01-05 separately retains 390 and 1440 shell coverage.
- Settings rows, navigation list and focus indicators remain reachable by keyboard. Axe reports zero serious or critical findings at every asserted settings width.
- P01-04 wallet bind/list/delete/confirm remains covered by the full desktop/mobile browser run.

No target site, Telegram service, external RPC, market service, transaction, signature, broadcast or funds action was used.
