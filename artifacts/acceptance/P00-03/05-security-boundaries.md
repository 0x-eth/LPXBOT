# Security Boundary Evidence

## Local Scope

- Compose project name is fixed as `lpbot-p00-local` in both configuration and command wrappers.
- PostgreSQL, Redis, MinIO, and Anvil publish only to `127.0.0.1`.
- Anvil command hard-codes chain ID `31337` and contains no fork or external RPC option.
- TimescaleDB telemetry is disabled and verified as `off`.
- Signer, API, worker, indexer, and all business applications were not connected to the database.
- No user, wallet, task, transaction, or other business table exists.

## Local Credentials

- `.env.example` contains local-development-only placeholder credentials.
- `.env` is ignored by `.gitignore`; `.env.example` is the allowed template.
- Lifecycle scripts use quiet configuration/status operations and do not print database URLs, Redis URLs/passwords, or MinIO credentials.
- Integration tests redact configured credential values from subprocess errors.
- The final service-log test checked every configured database, Redis, and MinIO credential value and passed.

## Reset Boundary

`infra:reset` contains an explicit four-volume allowlist. Before deletion it also requires each volume to carry `io.lpbot.local-project=lpbot-p00-local`. A name or label mismatch stops the reset with an error.

## Frozen Baseline

P00-03 pre-task commit:

```text
00634a4e12a8ec23fe51ee0b93f544607d2d938c
```

Git tree for `artifacts/lpbot/2026-08-13` before and after P00-03:

```text
0b24a81889eb728477e583c43c9121fac7235113
```

The hashes are identical and the path diff is empty.
