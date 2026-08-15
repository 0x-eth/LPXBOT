# P01-08 Initial Failure

- Baseline commit: `b1510673efe4ec474ecbd7e1df8e3eb903176079`
- Command: `node --test tests/governance/p01-completion.test.mjs`
- Result: expected failure (`2` passed, `2` failed)
- Classification: acceptance-package gap; no product regression was identified by this run.

```text
TAP version 13
# Subtest: P01-02 through P01-07 accepted manifests cover every P01 feature exactly once
ok 1 - P01-02 through P01-07 accepted manifests cover every P01 feature exactly once
# Subtest: each P01 implementation manifest meets its feature traceability minimums
ok 2 - each P01 implementation manifest meets its feature traceability minimums
# Subtest: P01-01 remains reference-only and P01-08 claims no implementation features
not ok 3 - P01-01 remains reference-only and P01-08 claims no implementation features
  error: P01-08 was absent from the acceptance directory inventory
# Subtest: P01 feature coverage records inspectable implementation, tests, evidence, and status
not ok 4 - P01 feature coverage records inspectable implementation, tests, evidence, and status
  error: ENOENT: artifacts/acceptance/P01-08/feature-coverage.json
1..4
# tests 4
# pass 2
# fail 2
```
