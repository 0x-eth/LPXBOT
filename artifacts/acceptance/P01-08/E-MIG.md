# E-MIG: Database repeatability and rollback

Evidence level: `local-fixture-verified`.

## Full cycle

`tests/integration/postgres-migration-cycle.integration.ts` creates an isolated empty PostgreSQL database and performs:

1. every migration up in filename order;
2. deterministic seed twice;
3. every migration down in reverse order;
4. a new database connection, matching separate dbmate command processes;
5. every migration up again;
6. deterministic seed twice again.

The first run showed that TimescaleDB cannot be dropped and recreated inside one backend session. The test now reconnects at the operational down/up boundary and leaves migration SQL unchanged. The final schema contains the 13 expected P01 tables, `pgcrypto`, `timescaledb`, five chain policies and five initial history rows.

## Behavior

- Preference writes use optimistic concurrency; concurrent revision-zero writers produce one `200` and one `409`, then restore from PostgreSQL.
- Chain history and management audit tables are append-only.
- Chain updates are atomic, conflict-safe and preserve the five-chain history.
- The local `all -> pro -> all` rollback uses the normal admin API and records before/after revisions and reasons.
- Migration and seed replay through dbmate are run twice from a reset local volume in the final infrastructure gate.

`pnpm test:postgres` passed 8 files and 20 tests after adding the complete cycle.
