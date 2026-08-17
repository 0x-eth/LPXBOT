# P03-02 RBAC Evidence

| Actor/action | Result |
|---|---|
| unauthenticated list or create | `UNAUTHENTICATED` |
| owner list/get/create/patch/lifecycle/delete | allowed subject to validation and revision |
| another user get/patch/enable/disable/delete | `MONITOR_NOT_FOUND` |
| user A and user B reuse the same Idempotency-Key | isolated records |

Monitor ownership comes only from the authenticated internal user ID. Client payloads cannot supply or mutate `userId`. PostgreSQL queries and foreign keys carry the owner key through monitors, candidates, watermarks, and Outbox rows; no admin override is introduced in this slice.
