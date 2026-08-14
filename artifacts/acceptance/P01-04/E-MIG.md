# E-MIG: Login wallet authentication persistence

## Migration source

- The sole P01-04 migration is `infra/migrations/20260814000300_create_login_wallet_auth.sql`.
- No application-local schema or parallel migration source was added.
- Applying all four migrations twice is a no-op, and the deterministic seed remains repeatable.

## Added tables

| Table | Stored data | Explicit exclusions |
|---|---|---|
| `auth_wallet_challenges` | 32-byte identifier, nonce, and message hashes; 20-byte address; chain; purpose; optional link user; timestamps | plaintext nonce, full message, signature, session credential |
| `auth_login_wallets` | UUID link, local user, unique 20-byte address, optional label, timestamps | private key, mnemonic, encrypted wallet, signer, transaction authority |

Schema checks constrain byte lengths, positive chain IDs, `login` or `link` purpose, purpose/user invariants, time ordering, label length, and global address uniqueness. Table comments explicitly classify the records as authentication identities only.

## Atomic operations

- Login consumption locks the challenge row, rechecks expiry and every stored binding, and updates `consumed_at` once.
- A per-address PostgreSQL advisory transaction lock serializes unknown identity creation. The winning transaction either resolves the existing login identity or creates one `pending` user and one login-wallet identity.
- Link consumption locks the challenge row and session user, takes the same address advisory lock, checks global uniqueness, consumes the challenge, and inserts the link in one transaction.
- Deletion locks the user and combines ownership and final-login-method checks in the `DELETE` statement. It returns `last-method` only when the owned link exists but no alternate Telegram identity or login wallet exists.

## Verification

- Two consecutive `pnpm db:migrate` runs passed.
- Two consecutive `pnpm db:seed` runs preserved the deterministic fixture.
- `pnpm infra:verify` passed for PostgreSQL, Redis, MinIO, and Anvil.
- `pnpm test:infra` passed 8/8 infrastructure tests with four migration records.
- `pnpm test:postgres` passed 3 files and 6 real PostgreSQL tests. Wallet coverage verifies 20-byte addresses, 32-byte hashes, absence of plaintext material, one-winner concurrent login, pending identity creation, cross-user binding rejection, duplicate binding rejection, owned deletion, and final-method protection.
- CI run `31787475239` passed the Infrastructure job, including repeatable migration/seed, PostgreSQL integration, cleanup, and volume reset.

All database activity used the isolated local Docker PostgreSQL fixture.

## Frozen trees

| Tree | Before | After |
|---|---|---|
| Frozen reference fixture | `0b24a81889eb728477e583c43c9121fac7235113` | `0b24a81889eb728477e583c43c9121fac7235113` |
| P01-01 acceptance | `85fcccb8e9858647f5237888967607767bd85a35` | `85fcccb8e9858647f5237888967607767bd85a35` |
| P01-02 acceptance | `97fe222b38b9635b17f5ae795e5c0c84b31d258b` | `97fe222b38b9635b17f5ae795e5c0c84b31d258b` |
| P01-03 acceptance | `3ce5c7bc9d67f1f4b50c0da23085b65fe200b5f5` | `3ce5c7bc9d67f1f4b50c0da23085b65fe200b5f5` |
