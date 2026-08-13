# E-SEC: Credential and privacy boundary evidence

## Credential storage and transport

- `SessionIssuer` generates 32 random bytes and exposes the opaque credential only to the caller.
- PostgreSQL stores a 32-byte SHA-256 digest in `sessions.token_hash`; no plaintext token column exists.
- Browser issuance uses `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, and an explicit expiry.
- Bearer compatibility is held only in the `AuthClient` instance. Tests assert that `localStorage` is never read, written, or cleared for authentication.

## Redaction

- API logs contain only event name, method, request ID, and status code.
- Tests inject credentials and personal fixture text into an unexpected exception and verify that neither appears in the response or log output.
- Access audit rows contain subject/session references, action, outcome, request ID, and time. They contain no token, Cookie, Authorization value, IP address, user agent, or profile field.

## Scans

- `pnpm audit:dependencies` completed with no known vulnerabilities locally.
- A local gitleaks binary was not installed, so no local secret-scan pass is claimed.
- GitHub Actions Security is the authoritative gitleaks result and will be recorded in `command-output.md` and the final manifest only after the final acceptance SHA completes.

No external RPC, target site, signature, transaction broadcast, funds operation, or production write was used.
