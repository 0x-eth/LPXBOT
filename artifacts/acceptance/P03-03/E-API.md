# P03-03 API Evidence

- `GET/PATCH /api/notification-preferences` exposes a current-user snapshot whose six categories default to disabled. PATCH requires `expectedRevision`, preserves the revision for a no-op, and returns the authoritative snapshot on conflict.
- `GET/POST/PATCH/DELETE /api/notification-destinations` implements current-user destination management. Creation requires a user-scoped `Idempotency-Key`; mutation and deletion require `expectedRevision`.
- Cross-user mutation and deletion return `DESTINATION_NOT_FOUND`. Client payloads cannot set an owner, and list/options responses are scoped from the authenticated session.
- Telegram creation accepts only the current user's linked Telegram identity. Webhooks accept GET or POST with validated HTTPS configuration and frozen P03-01 template variables.
- API responses contain only redacted configuration plus `secretConfigured` and opaque `secretRef`; Telegram bot tokens and Webhook HMAC keys never appear in success, conflict, or error bodies.
- `POST /api/notification-destinations/test` renders only to `local-sink://p03-01`. It performs zero network calls and does not write configuration, Outbox, history, notification audit payloads, or secrets.

Focused result: notification API/client/security and monitor binding tests passed 7 files / 27 tests.
