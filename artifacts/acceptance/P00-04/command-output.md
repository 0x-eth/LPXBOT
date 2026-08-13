# P00-04 Command Output Summary

Date: 2026-08-13 (Asia/Shanghai)  
Risk: R0

## TDD Red

Command:

```bash
node --test tests/governance/governance-checkers.test.mjs
```

Initial result: failed, 0 passed and 11 failed, because the three requested checker entrypoints did not exist. The failures were observed before checker implementation.

## Focused Green

Observed commands and results after implementation:

```text
node --test tests/governance/governance-checkers.test.mjs
  PASS  11 passed, 0 failed

node scripts/check-traceability.mjs
  PASS  196/196 unique feature IDs match

node scripts/check-doc-links.mjs
  PASS  27 relative links across 9 Markdown files

node scripts/check-baseline.mjs
  PASS  248 checksums and 247 manifest records
```

Full regression results are added only after the commands have run.
