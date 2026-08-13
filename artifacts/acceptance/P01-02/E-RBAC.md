# E-RBAC: Server-authoritative authorization evidence

## Role matrix

| Subject | authenticated | pro | admin | `/users` |
|---|---:|---:|---:|---:|
| anonymous | deny | deny | deny | deny |
| user | allow | deny | deny | deny |
| pro | allow | allow | deny | deny |
| admin | allow | allow | allow | allow |

No declared access level defaults to deny. An unknown role or access level also defaults to deny.

## Account and policy matrix

- Active user/pro/admin sessions are evaluated by the requested role requirement.
- Pending, rejected, and banned override every role, including admin, and return the corresponding 403 code.
- Region blocking overrides every role, including admin, and returns `403 REGION_BLOCKED`.
- Maintenance returns `503 MAINTENANCE` for user/pro and is explicitly bypassed by admin.
- Guard routes preserve 401, 403, and 503 semantics instead of reducing every denial to unauthenticated.

## Ownership

- An owner can access its own fixture resource.
- A different user is denied before fixture data is returned.
- Admin does not receive cross-user access by role alone; a separate authorized scope is required.
- The PostgreSQL session test confirms that revoking one user's session does not revoke or expose another user's session.

The client route guard is presentation defense only. The authoritative role, account-policy, and ownership decisions execute on the server.
