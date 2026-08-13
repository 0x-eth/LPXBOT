# Image and Platform Evidence

All image references in `infra/docker/compose.yaml` are pinned tags; none use `latest`.

| Purpose | Image | Observed platform |
|---|---|---|
| PostgreSQL 16 + TimescaleDB | `timescale/timescaledb:2.21.3-pg16` | `linux/arm64` |
| Redis | `redis:7.4.5-alpine` | `linux/arm64/v8` |
| MinIO | `minio/minio:RELEASE.2025-04-22T22-12-26Z` | `linux/arm64` |
| MinIO initializer | `minio/mc:RELEASE.2025-04-16T18-13-26Z` | ARM64 manifest present |
| Anvil | `ghcr.io/foundry-rs/foundry:v1.3.1` | `linux/arm64` |
| Migration CLI | `amacneil/dbmate:2.28.0` | ARM64 manifest present |

Runtime inspection of the four persistent containers reported the listed ARM64 platforms. Manifest inspection reported ARM64 entries for both one-shot tool images.

PostgreSQL protocol verification additionally reported a `16.x` server version. TimescaleDB telemetry is explicitly configured and verified as `off`.
