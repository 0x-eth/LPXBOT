# P00-05 Command Output Summary

Date: 2026-08-13 (Asia/Shanghai)  
Risk: R0

## TDD Red

The governance tests were extended before Playwright, Foundry, or CI implementation.

```text
node --test tests/governance/governance-checkers.test.mjs
  FAIL  14 passed, 3 failed
  - Playwright configuration was missing.
  - Foundry configuration was missing.
  - CI had four jobs instead of the required six jobs with Browser and Contracts gates.
```

The first browser execution also caught an occupied default port: the test reached an unrelated local Vite process and observed the title `流动性动向` instead of `LPBot`. The Playwright web server was moved to the dedicated port `43173` with `reuseExistingServer: false`; the suite then exercised only the Vite process it starts for `apps/web`.

The first complete GitHub Actions run exposed a second clean-checkout failure that local build output had masked:

```text
GitHub Actions run 31700529976, Browser job
  FAIL  Vite could not resolve @lpbot/api-contract because its ignored dist output did not exist
  PASS  Chromium and system dependency installation
  PASS  failure-only upload of playwright-report artifact 9181087799

node --test --test-name-pattern='repository exposes a real Playwright browser suite' tests/governance/governance-checkers.test.mjs
  FAIL  test:e2e did not build the apps/web workspace dependency first
```

The root `test:e2e` command was then changed to build the `apps/web` workspace dependency before Playwright. Moving the existing `packages/api-contract/dist` aside and rerunning the root command proved that the fix did not rely on cached build output.

## Focused Green

Observed locally with Node.js v22.23.1, pnpm 11.17.0, Playwright 1.62.1, Foundry 1.7.1, and solc 0.8.26:

```text
node --test tests/governance/governance-checkers.test.mjs
  PASS  17 passed, 0 failed

pnpm test:e2e
  PASS  2 passed
  - chromium-desktop: 1440x900
  - chromium-mobile: 390x844
  - apps/web Vite server started by Playwright on 127.0.0.1:43173
  - page render, pageerror, requestfailed, and console error assertions passed

CI=true pnpm test:e2e
  PASS  2 passed with one worker after a clean dependency build

forge fmt --check
  PASS

forge build
  PASS  2 Solidity files compiled with solc 0.8.26

pnpm test:contracts
  PASS  3 passed, 0 failed, 0 skipped
  - deployment and initial state
  - owner state change
  - unauthorized revert and unchanged state
```

The Foundry suite is self-contained. It has no external RPC endpoint, mainnet fork, Helper, or other P05 business contract.

## Local Regression

All commands below were run on the local host and passed:

```text
pnpm install --frozen-lockfile  PASS  lockfile unchanged
pnpm format:check              PASS
pnpm lint                      PASS  13/13 workspace tasks
pnpm typecheck                 PASS  19/19 workspace tasks
pnpm test                      PASS  5 Vitest + 17 governance tests
pnpm build                     PASS  13/13 workspace tasks
pnpm audit:dependencies        PASS  no known vulnerabilities
pnpm check:baseline            PASS  248 checksums and 247 manifest records
pnpm check:traceability        PASS  196/196 unique feature IDs match
pnpm check:docs                PASS  27 relative links across 9 Markdown files
```

Local infrastructure regression also passed:

```text
pnpm infra:up                  PASS  PostgreSQL, Redis, MinIO, and Anvil healthy
pnpm db:migrate (twice)        PASS  repeatable
pnpm db:seed (twice)           PASS  deterministic
pnpm infra:verify              PASS  MinIO ready; Anvil chain ID 0x7a69
pnpm test:infra                PASS  8 passed, 0 failed
pnpm infra:down                PASS
pnpm infra:reset               PASS  four local volumes removed
```

The frozen `artifacts/lpbot/2026-08-13` Git tree remained `0b24a81889eb728477e583c43c9121fac7235113`, identical to the pre-task tree.

## CI Configuration Evidence

The parsed workflow governance test passed with exactly six jobs and 14 Action references, all pinned to full 40-character SHAs. It also passed assertions that:

- Browser installs Chromium and system dependencies, runs `pnpm test:e2e`, and uploads `playwright-report/` only on failure.
- Contracts installs Foundry v1.7.1 and runs `forge fmt --check`, `forge build`, and `forge test -vvv`.
- No CI step is a constant-success placeholder.

## GitHub Actions Result

Final workflow run: <https://github.com/0x-eth/LPXBOT/actions/runs/31701116003>
Head SHA: `3db8f794e8aa81f64fca4184b60c7de2d431fb7c`

```text
Quality         PASS
Governance      PASS
Browser         PASS
Contracts       PASS
Infrastructure  PASS
Security        PASS
```

The final Browser job installed Chromium and Ubuntu system dependencies and ran both browser projects. The final Contracts job installed pinned Foundry v1.7.1 and passed format, build, and all three tests. The Security job ran Gitleaks and the dependency audit. The successful Browser run correctly skipped the failure-only report upload; the preceding Red run `31700529976` exercised that path and uploaded artifact `9181087799` with digest `sha256:f90df9f928db27cbaf3db2988cd0429796d441804bb76244839b65475c5d45cb`.

## Not Run Locally

The following were not run on the local macOS host and are not presented as local passes: Ubuntu system package installation, GitHub Action execution, the Gitleaks Action, and artifact upload. Their results above come only from the named GitHub-hosted runs. The final workflow emitted non-failing GitHub annotations that the pinned checkout, setup-node, and Gitleaks Actions target the deprecated Node.js 20 Action runtime and were forced by GitHub to Node.js 24.
