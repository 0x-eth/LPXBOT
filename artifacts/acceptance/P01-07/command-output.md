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

## GitHub Actions result

[Run 31827013669](https://github.com/0x-eth/LPXBOT/actions/runs/31827013669) attempt 3 passed all six jobs for stable commit `ec00f30077579e2670e010562befc994a35f0b62` and completed at `2026-08-15T17:09:36Z`.

| Job | Result | Runner ID | Executed steps |
|---|---|---:|---:|
| Quality | passed | 1000001770 | 13 |
| Governance | passed | 1000001767 | 14 |
| Browser | passed | 1000001768 | 11 |
| Contracts | passed | 1000001769 | 9 |
| Infrastructure | passed | 1000001771 | 17 |
| Security | passed | 1000001766 | 10 |

Every job received a nonzero runner ID and executed its gate steps. The Browser gate passed; only its failure-only report upload was conditionally skipped. Attempts 1 and 2, which had `runner_id: 0` and no steps, are not acceptance evidence.
