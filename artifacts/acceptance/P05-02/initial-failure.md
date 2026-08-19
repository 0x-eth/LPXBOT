# Initial Failure

The P05-02 implementation was developed test-first. The final governance test was added before status docs or evidence and produced the expected red result:

```text
node --test tests/governance/p05-02-completion.test.mjs
tests 5; pass 1; fail 4
missing: P05 status table, manifest, evidence directory, desktop/mobile screenshots
passing before evidence creation: P00 through P05-01 byte-identical 645-file baseline
```

Additional red regressions found during integration closure:

- Full PostgreSQL initially failed because the historical custody down/up test attempted to drop `custody_wallets` before the new dependent Helper tables. The fixture now executes the Helper down section inside the rollback transaction.
- Full Playwright initially reported six P04-06 failures because its strict API closure treated the three new read endpoints as unhandled. Explicit empty position, undeployed Helper, and null residual fixtures fixed the regression without weakening the unknown-request assertion.
- Visual inspection found platformId 1 rendered as PancakeSwap V3. A new failing E2E assertion reproduced the identity mismatch before the four UI labels were corrected.

No failure was bypassed by reducing product validation, RBAC, RPC restrictions, canonical-block checks, or execution counters.
