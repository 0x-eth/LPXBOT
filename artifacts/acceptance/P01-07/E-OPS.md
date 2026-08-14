# E-OPS: PostgreSQL policy operations, rollback, and integrity

Evidence level: `local-fixture-verified`.

## Schema and seed

`20260815000100_create_chain_access_policies.sql` creates:

- versioned current `chain_access_policies`;
- append-only `chain_access_policy_history`;
- append-only `chain_access_management_audit_events`.

`20260815000200_remove_user_allowed_chain_ids.sql` removes the competing per-user chain authority. Both migrations have real down paths. PostgreSQL tests execute down/up inside transactions and verify the expected schema after each transition.

The deterministic local seed registers 56, 8453, 1, 4663, and 196. BSC 56 is the local default and starts at `all`; the other local fixture policies start at `off`. The seed reason explicitly says it is not a live-observed value. Running migration twice and seed twice succeeded; seed replay preserved policy revisions and history.

## Atomic policy behavior

PostgreSQL tests verify:

- one transaction and advisory transaction lock per batch;
- optimistic revision checks;
- unchanged replay without a new revision/history row;
- unknown or partially invalid batch rollback;
- default-chain and readiness constraints;
- one winner for concurrent writers;
- rollback through the normal validated update method;
- unavailable registered rows resolve to `off` at revision zero.

## Local all -> pro -> rollback drill

The isolated `postgres-chain-operations.integration.ts` fixture created a real PostgreSQL database, ran all migrations and seed, issued a real local admin session, and called the normal management API twice:

| Step | BSC access | Revision | Previous | Reason |
|---|---|---:|---|---|
| Seed | `all` | 1 | null | deterministic local fixture seed |
| Restrict | `pro` | 2 | `all` | `Local all to pro operations drill` |
| Rollback | `all` | 3 | `pro` | `Local rollback operations drill` |

The history query returned all three revisions. The management audit query returned two allowed events with the same local actor/session, distinct request IDs, exact reasons, and matching before/after revision arrays. The session credential was absent from serialized audit data. The isolated database was dropped after the test.

## Local gate results

- `pnpm db:migrate` twice: passed.
- `pnpm db:seed` twice: passed.
- `pnpm infra:verify`: PostgreSQL, Redis, MinIO, and Anvil healthy.
- `pnpm test:infra`: 8/8 passed.
- `pnpm test:postgres`: 7 files / 19 tests passed.
- `pnpm check:all` and `pnpm check:p01-reference`: passed.

## Historical integrity

The requested start commit is an ancestor of the implementation. The working tree has zero differences from that commit under the frozen bundle and P01-01 through P01-06 acceptance paths.

| Tree | Verified tree object |
|---|---|
| Frozen `artifacts/lpbot/2026-08-13` | `0b24a81889eb728477e583c43c9121fac7235113` |
| P01-01 | `85fcccb8e9858647f5237888967607767bd85a35` |
| P01-02 | `97fe222b38b9635b17f5ae795e5c0c84b31d258b` |
| P01-03 | `3ce5c7bc9d67f1f4b50c0da23085b65fe200b5f5` |
| P01-04 | `74719d2183628ef6982cf85cb96afbd46274ad86` |
| P01-05 | `fbe95b3c6dbfe8ec898502a7d5f120800eb63ffc` |
| P01-06 | `fe87403c03ea780cdc092e58e9d18098f4e2620d` |

## CI status

Local equivalents of all six CI jobs pass. No qualifying six-job GitHub Actions run is available. [Run 31826761337](https://github.com/0x-eth/LPXBOT/actions/runs/31826761337) targets verified implementation commit `c399c836712c48344ffd0c460f9438f4e692ab69`; its initial attempt and explicit rerun both ended all six jobs in about two seconds with `steps: []`, `runner_id: 0`, and no failure log. The GitHub Check Run annotation says the jobs were not started because recent account payments failed or the spending limit needs to be increased. Repository code was not executed, so the run is not acceptance evidence. The manifest remains `in-progress`.
