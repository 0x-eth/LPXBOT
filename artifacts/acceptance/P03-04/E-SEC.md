# P03-04 Security Evidence

- `NotificationSecretStore.read` requires the exact `(userId, kind, secretRef)` tuple. Missing store configuration, absent references, ownership mismatch, and purpose mismatch fail closed.
- Secrets are read immediately before one delivery and are not stored in Outbox, history, acknowledgement, logs, errors, screenshots, or fixtures.
- Webhook production egress is HTTPS-only with TLS 1.2 minimum, certificate and hostname verification, and the original hostname retained as SNI while the connection is pinned to a validated IP.
- Every frozen IPv4, IPv6, mapped-IPv6, CNAME, mixed-answer, rebinding, metadata, private, reserved, multicast, and non-unicast scenario in `security-contracts.json` is replayed. Every DNS answer must be public unicast.
- Each connection and redirect re-resolves and revalidates DNS. GET follows 301/302/303/307/308; POST follows only 307/308; at most three redirects are accepted. Cookie and authorization headers are removed and HMAC is rebuilt on each hop.
- Proxy environment variables are ignored. The stable delivery ID is preserved across redirects and retries. HTTP, network, timeout, response-size, and bounded `Retry-After` outcomes map to frozen public error codes.
- Telegram verifies current identity ownership, renders escaped HTML, limits messages to 4096 Unicode code points, classifies provider/network failures, and persists only a sanitized acknowledgement of at most 120 code points.
- Tests use injected DNS, HTTP/TLS, and Telegram transports. Real notification network calls: 0.

Gitleaks 8.30.1 scanned 923 commits and approximately 22.37 MB with no leaks. `pnpm audit:dependencies` reported no known vulnerabilities.
