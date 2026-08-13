# TDD Red/Green Evidence

## Compose Contract Red

Command:

```bash
node --test tests/infra/compose-config.test.mjs
```

Initial result: failed because `.env.example` and `infra/docker/compose.yaml` did not exist.

Observed failure summary:

```text
couldn't find env file: .env.example
tests 1
pass 0
fail 1
```

The minimum `.env.example` and Compose configuration were then implemented. The same test passed.

## Service Contract Red

Command:

```bash
node --test --test-concurrency=1 tests/infra/services.test.mjs
```

Initial result: 1 passed, 5 failed. Failures identified the missing behavior:

```text
PostgreSQL extensions: expected pgcrypto,timescaledb; received empty result
schema_migrations: relation did not exist
database scripts: scripts/db.sh did not exist
MinIO: initialization endpoint was not ready
Anvil: service was not running
```

This run also exposed a pre-existing local Compose project named `lpbot-local`. The implementation was isolated under the fixed project name `lpbot-p00-local`; the unrelated project was left running.

## Final Green

Command:

```bash
pnpm test:infra
```

Final result after the reset/rebuild cycle:

```text
tests 8
pass 8
fail 0
duration_ms 2123.263
```

The green tests cover Compose structure, PostgreSQL 16/extensions/metadata-only schema, migration no-op, deterministic Seed no-op, Redis, MinIO, Anvil, and credential-free service logs.
