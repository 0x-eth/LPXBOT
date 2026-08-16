# E-RBAC

- Both chart endpoints use the existing session authentication boundary. Unauthenticated requests receive 401 before the market chart provider is read.
- The endpoints are read-only GET operations available at the authenticated access level; P02-10 adds no admin, ownership, task, preference, signer, or funds capability.
- Rate-limit identity is derived from the authenticated credential/session boundary rather than token, pool, bar, or range query values.
- The browser sends same-origin credentials and never places a session token in chart URLs, SSE payloads, chart metadata, or error text.
- `poolKey`, token, pool address/pool ID, protocol, spacing, decimals, bar, limit, and range are data selectors only. None is interpreted as a user identity or authorization override.
- Focused HTTP tests prove authentication and credential-keyed rate limiting for the new routes.
