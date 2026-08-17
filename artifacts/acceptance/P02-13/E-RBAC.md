# P02-13 RBAC Evidence

| Actor/query | Effective statistics scope | Result |
|---|---|---|
| user or pro, no `user_id` | signed-in internal UUID | allowed |
| user or pro, any valid `user_id` | none | 403 before SSE hijack |
| admin, no `user_id` | global aggregate | allowed |
| admin, known decimal Telegram `user_id` | UUID from `telegram_identities` | allowed and audited |
| admin, unknown decimal Telegram `user_id` | none | audited 404 before SSE hijack |

The filter never accepts an arbitrary internal UUID. Audit rows/log summaries contain actor UUID, target Telegram ID, resolved target UUID or null, request ID, transport, outcome, and time; they contain no session ID, cookie, authorization header, or credential.

The combined recommendation lane always derives eligibility from the signed-in session UUID. It does not read the queried user's private blocklist.
