# P00-03 Acceptance Evidence

Date: 2026-08-13 (Asia/Shanghai)  
Risk: R0  
Compose project: `lpbot-p00-local`  
Compose entrypoint: `infra/docker/compose.yaml`

## Result

P00-03 is accepted locally:

- PostgreSQL 16 with TimescaleDB and pgcrypto is healthy.
- Redis, MinIO, and local-only Anvil are healthy.
- dbmate applies the single migration source in `infra/migrations/`.
- The second migration run leaves migration history unchanged.
- The deterministic Seed leaves the fixture tuple and tuple transaction version unchanged.
- Redis PING/SET/GET/TTL, MinIO bucket/object lifecycle, and Anvil snapshot/revert pass.
- `infra:reset` removes only the four exact, labeled `lpbot-p00-local` volumes.
- A clean reset/rebuild/migrate/seed/verify/test cycle passes.
- The frozen `artifacts/lpbot/2026-08-13` Git tree is unchanged.
- Ordinary `pnpm test` remains independent of Docker.

## Evidence Files

- `01-tdd-red-green.md`: initial failing tests and final green result.
- `02-images-and-platforms.md`: pinned images and observed ARM64 platforms.
- `03-infra-and-database.md`: health, migration, Seed, and protocol checks.
- `04-reset-rebuild.md`: destructive isolation and clean rebuild evidence.
- `05-security-boundaries.md`: local-only and secret-handling checks.
- `06-quality-gates.md`: P00-02 regression gate results.

No local credential values or connection URLs are stored in this evidence package.
