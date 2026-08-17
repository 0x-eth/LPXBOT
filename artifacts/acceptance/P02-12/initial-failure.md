# P02-12 Initial Failure

The initial tests were written and run before implementation.

## Contract, API, client and store red run

Command:

```text
pnpm exec vitest run tests/pool-creation-provenance.test.ts tests/pool-creation-provenance-api.test.ts tests/pool-provenance-client.test.ts
```

Result: failed with exit code 1. The frozen provenance modules and client did not exist, and all seven read API expectations returned 404. The complete captured output is preserved in `/tmp/p02-12-initial-vitest.txt`; the durable summary is 178 lines with three failing test files.

## Governance red run

The initial governance run reported 24 passed and 5 failed. `POOL-15` was still planned and `manifest.json`, `golden/attribution.json`, `prior-acceptance-sha256s.txt`, and `sha256sums.txt` did not exist. The captured output is preserved in `/tmp/p02-12-initial-governance.txt`.

## UI red run

The focused desktop Playwright run reported 5 failed. There was no `创建历史` trigger, no administrator creator marker, and no batch request. The implementation was then added against those public UI assertions.

## Oversized request red run

The focused API test for a POST body over 32 KiB initially received HTTP 500 instead of the required no-store HTTP 413. The route-specific body-limit envelope and safe zero-identity audit summary were added after that failing assertion.
