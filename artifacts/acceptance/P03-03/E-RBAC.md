# P03-03 RBAC Evidence

| Actor/action | Result |
|---|---|
| unauthenticated preference, destination, options, or test request | `UNAUTHENTICATED` |
| owner preference GET/PATCH | allowed with CAS |
| owner destination list/create/patch/delete | allowed subject to validation and revision |
| another user PATCH/DELETE | `DESTINATION_NOT_FOUND` |
| user A and user B reuse one Idempotency-Key | isolated destination records |
| user selects another account's Telegram identity | `INVALID_DESTINATION` |
| monitor binds another user's destination | destination-not-found result |

Ownership comes exclusively from the authenticated internal user ID. No request DTO contains `userId`, no administrative override is introduced, and PostgreSQL composite foreign keys preserve owner identity across destination versions and monitor bindings.
