# P02-02 local command results

Evidence level: `local-fixture-verified` only.

## Red phase

The first focused run failed because the indexer modules, market implementation, pool API, stream reducer, and `/pools` tracer did not exist. Later regression tests also failed before their fixes:

- complete migration cycle expected 13 tables but received the seven new market tables;
- decimal client ordering produced `9.9, 10` instead of `10, 9.9`;
- golden verification failed while P02-02 golden files were absent;
- stale old-branch duplicate replay returned `revertedCount=1`;
- 600-event replay returned sequence `10` before sequence `2` due text ordering;
- Playwright failed while desktop/mobile pool baselines were absent and after intentional visual changes.

## Focused green phase

| Gate | Result |
|---|---|
| Indexer runner and production fail-closed tests | passed; 5/5 |
| Arbitrary-precision market metrics | passed; 3/3 |
| Pool API plus existing stats stream regression | passed; 6/6 |
| Pool stream reducer | passed; 4/4 |
| Real PostgreSQL indexer/provider/golden suite | passed; 10/10 |
| Complete PostgreSQL migration cycle | passed; 1/1 |
| Pool Playwright states, keyboard, overflow, screenshots, and axe | focused runs passed on desktop/mobile |
| Root TypeScript after Decimal import fix | passed |

## Final gates

Final format, lint, typecheck, test, build, full e2e, PostgreSQL, migration, governance, Gitleaks, dependency audit, and six-job-equivalent results will be written here before the manifest is closed.
