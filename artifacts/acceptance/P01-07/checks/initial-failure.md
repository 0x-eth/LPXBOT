# TDD initial failure record

Evidence level: `local-fixture-verified`.

| Slice | Initial red result | Green result |
|---|---|---|
| Domain policy and registry | 8/8 failed because policy and registry interfaces were absent | exhaustive policy and registry tests passed |
| PostgreSQL migration | 3/3 failed because chain policy/history/audit tables were absent | real migration/seed/down-up tests passed |
| PostgreSQL store | 5/5 failed because the policy store was absent | atomic/idempotent/conflict/rollback tests passed |
| API and session authority | 6/6 failed because routes/guard were absent and session chains came from users | API/RBAC tests passed |
| Legacy authority migration | failed while `allowed_chain_ids` remained | column and stored-account authority removed |
| Administrator UI | ordinary/pro cases passed; four admin cases failed because the entry and dialog were absent | focused Playwright passed 8/8 |
| Unseeded revision-zero view | rejected with `INVALID_RESPONSE` | browser client accepts `off/revision=0` |
| Stable readiness error | incomplete chain returned 200 in weak memory fixture | API returns `CHAIN_NOT_READY` 409 |
| Inconsistent admin tier | GET returned full management fields | GET returns an empty safe view and POST returns 403 |

The first five red runs were captured before the resumed UI implementation. The last four red/green slices were rerun during final boundary review.
