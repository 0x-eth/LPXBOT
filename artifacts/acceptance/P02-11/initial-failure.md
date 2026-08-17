# P02-11 Initial Failure

Command:

```text
pnpm exec vitest run tests/pool-blocklist-contract.test.ts tests/pool-eligibility-policy.test.ts
```

Result: failed with exit code 1 before implementation.

Observed failures:

```text
FAIL tests/pool-blocklist-contract.test.ts
Error: Cannot find module '../apps/api/src/pool-blocklist.js'

FAIL tests/pool-eligibility-policy.test.ts (4 tests)
TypeError: createPoolEligibilityPolicy is not a function
```

This red run preceded the P02-11 blocklist contract and shared eligibility policy implementation.
