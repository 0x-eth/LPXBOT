# E-API: Chain policy, management contract, and server guard

Evidence level: `local-fixture-verified`.

## Authorization policy

`@lpbot/domain` defines `off | pro | all` and `read | monitor | unwind | new-exposure`. The exhaustive 36-case test fixes the following new-exposure decisions:

| Mode | user | pro | admin |
|---|---:|---:|---:|
| `all` | allow | allow | allow |
| `pro` | deny `CHAIN_PRO_REQUIRED` | allow | allow |
| `off` | deny `CHAIN_CREATION_DISABLED` | deny | deny |

`read`, `monitor`, and `unwind` are not blocked by chain mode. Session validity, resource ownership, and RBAC remain mandatory. Unknown modes, roles, tiers, operation categories, actions, and chains fail closed.

The named action map classifies task creation, pool creation, position increase, compounding, and switch-pool creation as `new-exposure`; pool withdrawal, task stop, position close, and emergency exit as `unwind`.

## HTTP contract

- `GET /api/system-config/chains` is authenticated and `Cache-Control: no-store`.
- user receives only `all` chains; pro receives `all` and `pro` chains. Those views expose only `chainId` and `displayName`.
- A trusted admin role/tier pair receives access, revision, update metadata, readiness, default-chain status, rollback metadata, and nullable activity count.
- `POST /api/system-config/chains` accepts only `access`, `expectedRevision`, and a non-empty `reason`.
- Anonymous writes return 401; user/pro and inconsistent admin/tier writes return 403.
- The write route enforces same-origin requests, a 4 KiB body limit, per-session fixed-window rate limiting, and exact field whitelisting.
- Stable safe errors cover `CHAIN_UNKNOWN`, `CHAIN_NOT_READY`, `CHAIN_CREATION_DISABLED`, `CHAIN_PRO_REQUIRED`, `DEFAULT_CHAIN_REQUIRED`, and `CONFIG_CONFLICT`.
- An unchanged replay returns `unchanged` without advancing revision. Rollback uses the same POST request, validation, admin, reason, and optimistic revision path.

The chain guard is exercised only through `/api/test/chain-access` when `testRoutes` is enabled. The production configuration returns `NOT_FOUND`; no task, pool, position, swap, or transaction business endpoint was added.

## Test results

- Focused domain, registry, browser-client, API, RBAC, audit, and safe-error suite: 4 files / 17 tests passed.
- Full root suite: 29 Vitest files / 162 tests plus 19 governance tests passed.
- PostgreSQL API/store/migration suite: 7 files / 19 tests passed.

The API response and route evidence is new local behavior. The frozen `{ chains: [...] }` shape is only `frozen-bundle-candidate`; it is not promoted to a current live observation.
