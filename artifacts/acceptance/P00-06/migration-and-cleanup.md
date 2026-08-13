# P00-06 Migration and Cleanup Evidence

## Accepted Clean Run

The accepted run began with no P00 containers, network, or named volumes. `pnpm accept:p00` first executed `pnpm infra:reset`, then ran:

```bash
pnpm infra:up
pnpm db:migrate
pnpm db:migrate
pnpm db:seed
pnpm db:seed
pnpm infra:verify
pnpm test:infra
```

Observed results:

```text
PostgreSQL/TimescaleDB  healthy
Redis                   healthy
MinIO                   healthy; bucket ready
Anvil                   healthy; chain ID 0x7a69 (31337)

first migration   Applied 20260813000100_initialize_local_metadata.sql
second migration  PASS; no pending migration and no history mutation
first seed         Deterministic local seed applied
second seed        Deterministic local seed applied
test:infra         PASS; 8 passed, 0 failed
```

The infrastructure suite independently reran migration and seed checks and verified TimescaleDB/pgcrypto, deterministic metadata, Redis TTL behavior, MinIO object operations, Anvil snapshot/revert, and credential-free logs.

## Guaranteed Cleanup

`scripts/accept-p00.sh` installs `trap cleanup EXIT`. After the accepted run it executed:

```bash
pnpm infra:down
pnpm infra:reset
```

Observed cleanup removed all four containers, the `lpbot-p00-local-network`, and exactly these label-checked volumes:

```text
lpbot-p00-local-postgres-data
lpbot-p00-local-redis-data
lpbot-p00-local-minio-data
lpbot-p00-local-anvil-data
```

Post-run Docker queries for project containers, network, and labeled volumes returned no entries. The temporary `.env` existed only inside the disposable worktree, and the worktree's final `git status --short` was empty.

## Environment Diagnostic Kept as a Failure

The first isolated attempt used a macOS `/tmp` worktree. Services became healthy, but dbmate reported `no migration files found`. The EXIT trap still removed all containers, network, and four volumes. A minimal bind-mount probe showed the SQL file existed on the host while Colima presented an empty `/tmp/.../infra/migrations` directory inside the VM because `/tmp` was not shared.

No repository migration result was inferred from that attempt. The same SHA was rerun from a Docker-shared `/Users/alpha/Projects` worktree and produced the accepted results above. The root README now records this Colima/Docker file-sharing prerequisite.
