# Reset and Clean Rebuild Evidence

## Isolation Before Reset

The four removable volumes were present with the required project label:

```text
lpbot-p00-local-postgres-data lpbot-p00-local
lpbot-p00-local-redis-data lpbot-p00-local
lpbot-p00-local-minio-data lpbot-p00-local
lpbot-p00-local-anvil-data lpbot-p00-local
```

An unrelated local project was also running before the reset:

```text
lpbot-local-postgres-1 healthy
lpbot-local-redis-1 healthy
lpbot-local-minio-1 healthy
```

## Reset

Command:

```bash
pnpm infra:reset
```

Result:

- Stopped and removed only `lpbot-p00-local` containers/network.
- Checked each exact volume's `io.lpbot.local-project=lpbot-p00-local` label.
- Removed exactly the four listed `lpbot-p00-local-*` volumes.
- A label-filtered volume query returned no remaining P00 volumes.
- The unrelated `lpbot-local` containers remained running and healthy.

## Clean Rebuild

Commands:

```bash
pnpm infra:up
pnpm db:migrate
pnpm db:seed
pnpm infra:verify
pnpm test:infra
```

Result:

```text
four named volumes created
four persistent services healthy
fixed MinIO bucket initialized
first migration applied
deterministic Seed applied
infra:verify passed
test:infra: 8 passed, 0 failed
```

No fixed sleeps are used. Service startup uses Compose health waiting with a configurable 120-second default timeout. One-shot commands use a configurable 30-second default timeout, and integration-test subprocesses use a 30-second timeout.
