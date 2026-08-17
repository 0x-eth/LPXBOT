# P03-04 RBAC Evidence

| Actor/action | Result |
|---|---|
| unauthenticated history request | `UNAUTHENTICATED` |
| current user lists or filters own history | allowed |
| current user supplies another user's monitor ID | empty result |
| user A reuses user B's cursor tuple | still constrained by user A ownership |
| Dispatcher resolves a deleted or disabled current destination | terminal fail before provider I/O |
| Dispatcher loads a destination revision for the wrong owner/channel/ID | terminal identity mismatch before provider I/O |
| Dispatcher reads a secret with wrong owner, purpose, or reference | fail closed |
| Telegram destination targets an identity no longer owned by current user | terminal fail before transport |
| monitor or destination is deleted | owner history snapshot retained |
| owning user is deleted | history removed by privacy cascade |

Ownership originates from the authenticated internal user ID and the Outbox tuple. The API never accepts a caller-supplied owner, and PostgreSQL history queries always include the owner predicate.
