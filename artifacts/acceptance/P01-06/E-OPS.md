# E-OPS: Persistence, PWA policy, gates and integrity

## Database operations

- `20260814000400_create_user_preferences.sql` is a real dbmate PostgreSQL migration. `pnpm db:migrate && pnpm db:migrate` completed successfully; the second run was a no-op.
- `pnpm db:seed && pnpm db:seed` completed successfully and preserved the deterministic fixture tuple.
- Infrastructure verification reported PostgreSQL, Redis, MinIO and Anvil healthy, the MinIO bucket ready and local chain ID `0x7a69`.
- `pnpm test:infra` passed 8/8. Its migration assertion now derives the exact ordered version list from `infra/migrations` and includes `user_preferences`, preventing a stale hard-coded count.
- `pnpm test:postgres` passed 4 files / 8 tests, including defaults, persistence, simultaneous revision writers, schema-version migration and cross-user isolation for preferences.

## PWA and cache behavior

- PWA manifest background and theme defaults are `#ffffff`; runtime theme changes synchronize the document theme-color meta and `color-scheme`.
- The service worker version is `p01-06-v1`. `/api` and `/api/**`, Authorization-bearing requests, SSE Accept requests, writes and same-origin runtime navigation remain `NetworkOnly`.
- No API, session, preference, SSE, Cookie response or runtime navigation response is stored in Cache Storage.
- `pnpm test:pwa` passed 4/4 for manifest/activation, offline anonymous shell, obsolete cache cleanup and sensitive/runtime network-only behavior.

## Local quality and security gates

| Gate | Result |
|---|---|
| `pnpm format:check` | passed |
| `pnpm lint` | passed; 13 workspace tasks plus root ESLint |
| `pnpm typecheck` | passed; 19 Turbo tasks plus root TypeScript |
| `pnpm test` | passed; 25 Vitest files / 145 tests and 19 governance tests |
| `pnpm build` | passed; 13 workspace packages and injectManifest PWA output |
| `pnpm test:e2e` | passed; 65 Chromium tests, 3 intentional project skips |
| `pnpm test:pwa` | passed; 4/4 |
| `forge fmt --check`, `forge build`, `pnpm test:contracts` | passed; 3/3 Foundry tests |
| `pnpm check:all`, `pnpm check:p01-reference` | passed locally; re-run after the P01-06 manifest was added |
| Dockerized Gitleaks 8.30.0 | passed; 282 commits, about 18.46 MB, no leaks |
| `pnpm audit:dependencies` | passed; no known vulnerabilities |

Linux P01-06 visual baselines were generated in a clean external clone using `mcr.microsoft.com/playwright:v1.62.1-noble` after building workspace dependencies. The update run passed 2/2; a second no-update Linux run and a Darwin no-update run both passed 2/2.

## CI status

The acceptance manifest remains `in-progress` until a stable implementation/evidence commit completes all six GitHub Actions jobs: Quality, Governance, Browser, Contracts, Infrastructure and Security. A cancelled run caused by auto-sync is not accepted as evidence.

## Frozen and prior acceptance integrity

| Tree | Pre-P01-06 | Current verified content |
|---|---|---|
| Frozen reference fixture | `0b24a81889eb728477e583c43c9121fac7235113` | unchanged |
| P01-01 acceptance | `85fcccb8e9858647f5237888967607767bd85a35` | unchanged |
| P01-02 acceptance | `97fe222b38b9635b17f5ae795e5c0c84b31d258b` | unchanged |
| P01-03 acceptance | `3ce5c7bc9d67f1f4b50c0da23085b65fe200b5f5` | unchanged |
| P01-04 acceptance | `74719d2183628ef6982cf85cb96afbd46274ad86` | unchanged |
| P01-05 acceptance | `fbe95b3c6dbfe8ec898502a7d5f120800eb63ffc` | unchanged after restoring generated actuals |

The frozen baseline checker still validates 248 checksums and 247 manifest records. The P01-01 checker validates 33 manifest records, 34 checksums and 9 routes.

## Operational boundary

- CI and normal local startup use deterministic providers or unavailable/null state. They do not connect to an external RPC, market feed, target site, Telegram service or production API.
- P01-06 does not implement `AUTH-10`, a P02 indexer/market feed, real gas acquisition, P06 task business pages or later settings.
- No transaction, signature, approval, broadcast, funds action, real wallet, production credential or production write occurred.
