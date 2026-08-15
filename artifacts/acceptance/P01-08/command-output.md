# P01-08 command output

Baseline: `b1510673efe4ec474ecbd7e1df8e3eb903176079` (`origin/main` at task start).

## Completed focused runs

| Command | Result |
|---|---|
| `node --test tests/governance/p01-completion.test.mjs` before artifacts | expected red: 2 passed, 2 failed |
| focused 27-file P01 Vitest command | passed: 27 files, 154 tests |
| initial P01 route-state Playwright desktop run | expected red: 3 failed; retained in `initial-failure.md` |
| P01 route-state desktop/mobile four-state and three-theme run | four matrix tests passed; width test exceeded default timeout without assertion failure |
| focused five-width matrix after dedicated timeout | passed: 1 test, 45 route/width combinations |
| first `pnpm test:postgres` with full migration cycle | expected red: 19 passed, 1 TimescaleDB same-session failure |
| `pnpm test:postgres` after operational reconnect boundary | passed: 8 files, 20 tests |
| P01-08 acceptance-checker boundary test | passed; only P01-08 may be featureless |

## Final local gates

| Command | Result |
|---|---|
| `pnpm format:check` | passed |
| `pnpm lint` | passed: 13 workspace packages plus repository scripts/tests, zero warnings |
| `pnpm typecheck` | passed: 13 workspace packages plus root strict TypeScript |
| `pnpm test` | passed: 29 Vitest files/162 tests and 24 Node governance tests |
| `pnpm build` | passed: 13 workspace packages and production PWA build |
| `LPBOT_PLAYWRIGHT_PORT=43180 pnpm test:e2e` | passed: 78 tests, 4 intentional project-specific skips |
| focused P01-06 strict screenshot rerun after evidence-write guard | passed: desktop/mobile 2 tests; P01-01..07 working content unchanged |
| `pnpm test:pwa` | passed: 4 build/preview tests |
| empty volumes; migrate twice; seed twice; `pnpm infra:verify`; `pnpm test:infra` | passed: 8 infrastructure tests |
| `pnpm test:postgres` repeated after cleanup repair | passed twice: 8 files/20 tests per run |
| `forge fmt --check && forge build && pnpm test:contracts` | passed: 3 Foundry tests |
| `pnpm check:all && pnpm check:p01-reference` | passed: frozen baseline, 196/196 traceability, P00, docs, 11 manifests and P01-01 reference |
| `node --test tests/governance/p01-completion.test.mjs` | passed: 4 tests |
| Dockerized Gitleaks v8.30.0 full-history scan | passed: 338 commits, 18.77 MB, no leaks |
| `pnpm audit:dependencies` | passed: no known vulnerabilities |

The full Playwright and PostgreSQL red runs that led to test-harness fixes are retained in [initial-failure.md](./initial-failure.md). The final P01-06 strict visual rerun left its existing masks, `maxDiffPixels: 60` threshold and historical screenshots unchanged.

## Baseline CI

Run [31897638440](https://github.com/0x-eth/LPXBOT/actions/runs/31897638440) is `success` for baseline commit `b1510673efe4ec474ecbd7e1df8e3eb903176079`.

| Job | Result |
|---|---|
| Quality | passed |
| Governance | passed |
| Browser | passed |
| Contracts | passed |
| Infrastructure | passed |
| Security | passed |

This run does not prove the P01-08 changes.

## Current-change CI

Pending a stable P01-08 commit. The manifest commit, completion time and six-job run are filled only after all jobs execute successfully.
