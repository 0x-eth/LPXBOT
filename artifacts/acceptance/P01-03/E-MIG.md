# E-MIG: Telegram authentication persistence

## Migration source

- The sole new migration is `infra/migrations/20260814000200_create_telegram_auth.sql`.
- No application-local schema or alternate migration source was added.
- Applying migrations twice is a no-op, and the deterministic seed remains repeatable.

## Added tables

| Table | Stored data | Explicit exclusions |
|---|---|---|
| `telegram_identities` | positive Telegram subject, local user ID, creation time | profile, username, Bot Token |
| `telegram_init_data_replays` | 32-byte digest, consumption time | raw `initData`, request body |
| `telegram_bot_login_intents` | UUID, 32-byte token hash, state, local user reference, state timestamps | plaintext token, Cookie, session credential |

The intent table constrains all five states and their timestamp/user invariants. Open-intent expiry and user-history indexes cover the state transitions without adding unrelated tables.

## Atomic operations

- Replay consumption uses one conflict-safe insert.
- Telegram identity creation uses a subject-scoped PostgreSQL advisory transaction lock.
- Bot confirmation locks the intent row before expiry, identity mapping, and state transition.
- Bot first consumption locks the intent, marks it consumed, and inserts the hashed session in the same transaction.
- Cancellation uses the same row lock and can transition only `pending` or `confirmed` intents.

## Verification

- Two consecutive migration runs and two consecutive seed runs passed.
- `pnpm test:infra` passed 8 infrastructure tests with 3 migration records and the three Telegram tables in the expected public schema.
- `pnpm test:postgres` passed 4 tests across 2 files, covering concurrent replay, concurrent unknown identity mapping, one-winner polling, hash-only persistence, and cancellation/consumption serialization.
- CI run `31781761117` passed the Infrastructure job including cleanup.

All database activity used the isolated local Docker PostgreSQL fixture.
