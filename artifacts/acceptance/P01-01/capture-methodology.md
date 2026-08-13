# P01-01 Read-only Capture Methodology

Captured: 2026-08-14 (Asia/Shanghai)  
Risk: R0  
Feature IDs closed: none

## Scope

The capture used the existing authenticated ordinary-user tab in the Codex in-app Browser. Passwords, cookies, JWTs, Telegram initData, request headers, browser storage, wallet addresses, account identifiers, raw bodies and query values were never read or saved.

Only visible SPA navigation controls, viewport changes, DOM summaries and screenshots were used. No create, save, submit, toggle, reset, delete, sign, broadcast, transfer, swap, task operation, notification, feedback or admin control was invoked. The Browser did not expose complete request-method telemetry, so this package does not claim a full HAR. The action audit is in `checks/read-only-audit.json`.

## Redaction

Raw screenshots existed only under `/tmp`. Browser-computed rectangles first covered full addresses, long identifiers, currency values and the account control. A second human-review policy covered truncated addresses, usernames, custom task/wallet labels, balances and request examples. Only opaque-redacted PNG files entered this directory; the policy is machine-readable in `screenshot-redaction-policy.json`.

## Evidence Levels

- `live-observed`: visible authenticated UI/DOM in this capture.
- `live-doc-observed`: response schema visible in the authenticated developer page; the endpoint was not replayed.
- `frozen-bundle-candidate`: candidate found in the unchanged 2026-08-13 Bundle.
- `unverified`: current account or R0 boundary could not exercise the state.

## Coverage Decision

Canonical ordinary-user no-funds routes are the nine pages with desktop/mobile screenshots. `/` and `/all/:status?` are redirect contracts and do not need duplicate screenshots. `/users`, blocked, maintenance and region-blocked states remain unverified. The chat surface is a global overlay rather than a route in the frozen router and is outside the P01 feature set.

## Browser WebMCP

The user approved `webmcp_list_tools`. The current tab advertised only `pageAssets`; an explicit WebMCP capability lookup returned capability-not-exposed. No WebMCP tool was called and no tool list result was synthesized.

## Frozen Baseline

`artifacts/lpbot/2026-08-13` was not edited. Its Git tree and fixed SHA-256 anchors are checked separately in `checks/frozen-baseline.txt`.
