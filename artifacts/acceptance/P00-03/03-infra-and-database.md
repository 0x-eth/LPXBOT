# Infrastructure and Database Evidence

## Health Verification

Command:

```bash
pnpm infra:verify
```

Result:

```text
postgres: healthy
redis: healthy
minio: healthy
anvil: healthy
MinIO bucket: ready
Anvil chain ID: 0x7a69
```

All published ports are bound to `127.0.0.1` and are configurable through `.env`.

## Migration and Seed

Commands executed on a clean PostgreSQL volume:

```bash
pnpm db:migrate
pnpm db:seed
pnpm db:status
```

Result summary:

```text
Applying: 20260813000100_initialize_local_metadata.sql
Applied: 20260813000100_initialize_local_metadata.sql
[X] 20260813000100_initialize_local_metadata.sql
Applied: 1
Pending: 0
Deterministic local seed applied.
```

Database assertions:

- PostgreSQL major version is 16.
- `timescaledb` and `pgcrypto` are installed and available.
- TimescaleDB telemetry level is `off`.
- `public` contains only `schema_migrations` and `app_metadata`.
- Migration history contains exactly one version.
- Running migration again preserves both the version and migration-history tuple `xmin`.
- Running Seed twice preserves key, value, fixed UTC timestamp, row count, and tuple `xmin`.
- Fixture metadata is exactly `fixture_version = p00-03-v1` with fixed timestamp `2026-08-13T00:00:00Z`.

## Protocol Verification

Final `pnpm test:infra` result:

```text
Compose structure                                      PASS
PostgreSQL 16 / TimescaleDB / pgcrypto / metadata     PASS
Migration second run is a no-op                        PASS
Seed second run preserves the same tuple               PASS
Redis PING / SET / GET / TTL                           PASS
MinIO bucket / put / get / delete                      PASS
Anvil chain ID / snapshot / revert                     PASS
Configured credentials absent from service logs        PASS
```
