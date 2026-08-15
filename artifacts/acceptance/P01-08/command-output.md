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

This run does not prove the P01-08 changes. Final local and current-commit CI gates are appended after execution.
