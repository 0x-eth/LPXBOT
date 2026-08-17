# P03-03 Security Evidence

- The P03-01 `webhook-security.json` fixture is replayed byte-for-byte for GET value encoding, POST JSON escaping, Telegram HTML escaping, oversize rejection, and the HMAC-SHA256 known answer.
- Templates accept only the frozen double-curly variable set. Unknown, malformed, misplaced, or missing variables fail before any network boundary.
- Limits are enforced at 16 KiB template bytes, 4 KiB expanded URL bytes, 64 KiB POST body bytes, and 4096 Telegram Unicode code points.
- GET has an empty body and RFC3986-encodes each configured query value. POST parses and structurally validates JSON before storage, then serializes substituted string values with JSON escaping.
- Webhook signatures use the frozen canonical envelope, exact body SHA-256, and a stable delivery ID. Secret values are write-only and kept behind `NotificationSecretStore` references.
- No DNS lookup, redirect, Telegram call, Webhook request, dispatcher, or other external notification I/O exists in this slice. Live adapters, complete SSRF egress enforcement, and delivery SLO evidence remain unresolved under MON-06.
- Gitleaks scans the full repository history and `pnpm audit:dependencies` checks the pinned dependency graph in the final security gate.
