# E-RBAC: Telegram subject and account-policy evidence

## Identity boundary

- A verified positive Telegram user ID is treated as an external subject, not as a local role or authorization claim.
- PostgreSQL maps that subject through `telegram_identities` to one local user.
- Unknown subjects create a `user` / `normal` account with status `pending`, no profile fields, and no allowed chains.
- A PostgreSQL advisory transaction lock serializes concurrent creation for the same subject, preventing duplicate identities and orphan users.

## Account policy after authentication

| Local account status | HTTP result | Client result |
|---|---|---|
| active | 200 with `SessionView` | protected shell |
| pending | 403 `ACCOUNT_PENDING` | `/blocked` pending state |
| rejected | 403 `ACCOUNT_REJECTED` | `/blocked` rejected state |
| banned | 403 `ACCOUNT_BANNED` | `/blocked` banned state |

The Mini App API test exercises all four rows after valid Telegram verification. Bot consumption uses the same `authorizeAccount` policy before returning a session view.

## Server authority

- Neither Mini App profile data nor Bot `/start` text supplies role, tier, status, or chain access.
- `apps/telegram-bot` imports the shared confirmation port and does not import `apps/api`.
- The replica-internal cancel endpoint changes intent state only; it does not grant access.
- Concurrent polls can issue one server session at most, and later polls receive `LOGIN_TOKEN_CONSUMED`.
- No public confirmation helper, wallet placeholder, client-side role override, or authentication bypass was added.

All observations are `local-fixture-verified`; no live Telegram account or production identity was used.
