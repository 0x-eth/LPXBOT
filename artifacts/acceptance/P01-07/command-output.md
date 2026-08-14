# P01-07 local command results

| Gate | Result |
|---|---|
| `pnpm format:check` | passed |
| `pnpm lint` | passed; 13 workspace tasks plus root ESLint |
| `pnpm typecheck` | passed; 19 Turbo tasks plus root TypeScript |
| `pnpm test` | passed; 29 Vitest files / 162 tests and 19 governance tests |
| `pnpm build` | passed; 13 workspace packages and injectManifest output |
| `LPBOT_PLAYWRIGHT_PORT=43174 pnpm test:e2e` | passed; 73 tests, 3 intentional project skips |
| P01-07 focused Playwright | passed; 8/8 desktop/mobile |
| `pnpm test:pwa` | passed; 4/4 |
| `pnpm test:postgres` | passed; 7 files / 19 tests |
| migration twice / seed twice | passed |
| `pnpm infra:verify` | passed; four services healthy |
| `pnpm test:infra` | passed; 8/8 |
| `forge fmt --check`, `forge build`, `pnpm test:contracts` | passed; 3/3 tests |
| `pnpm check:all` | passed; frozen baseline, 196 features, P00, links, manifests |
| `pnpm check:p01-reference` | passed; 33 records, 34 checksums, 9 routes |
| Dockerized Gitleaks 8.30.0 | passed; 317 commits, about 18.64 MB, no leaks |
| `pnpm audit:dependencies` | passed; no known vulnerabilities |

The full browser run rewrote one P01-06 generated `actual` screenshot. It was restored from `9ad094654659f9eab98319d48f59d2c7e18978ed`; the final historical-path diff is empty.

GitHub Actions is not recorded as passed. [Run 31826761337](https://github.com/0x-eth/LPXBOT/actions/runs/31826761337) targets verified implementation commit `c399c836712c48344ffd0c460f9438f4e692ab69`; both its initial attempt and explicit rerun ended all six jobs with no executed steps, `runner_id: 0`, and no failure log. The Check Run annotation attributes this to failed account payments or a spending limit. It cannot qualify the work item for acceptance.
