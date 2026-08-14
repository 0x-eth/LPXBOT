# P01-05 command evidence

Recorded on 2026-08-14 (Asia/Shanghai).

## Local results

| Command | Observed result |
|---|---|
| `pnpm format:check` | passed; all matched files use Prettier |
| `pnpm lint` | passed; 13 workspace lint tasks plus root lint |
| `pnpm typecheck` | passed; 19 Turbo tasks plus root TypeScript |
| `pnpm test` | passed; 21 Vitest files / 132 tests and 19 governance tests |
| `pnpm build` | passed; 13 workspace builds and injectManifest PWA output |
| `pnpm test:e2e` | passed; 53 Chromium tests across desktop/mobile, 1 intentional project skip |
| `pnpm test:pwa` | passed; 4 independent production build/preview PWA tests |
| Linux screenshot update in `mcr.microsoft.com/playwright:v1.62.1-noble` | passed; 2/2 strict shell snapshots generated after workspace dependency build |
| `forge fmt --check`, `forge build`, `pnpm test:contracts` | passed; 3/3 Foundry tests |
| `pnpm check:all` | passed; frozen checksums, 196/196 IDs, P00, docs, and 8 acceptance manifests |
| `pnpm check:p01-reference` | passed; frozen P01-01 records, checksums, and route matrix |
| Dockerized Gitleaks 8.30.0 | passed; 250 commits, approximately 18.29 MB, no leaks |
| `pnpm audit:dependencies` | passed; no known vulnerabilities |

## TDD sequence

The auto-sync history preserves test-first red/green ordering:

| Test-first commit | Red contract | First implementation commit |
|---|---|---|
| `36b57f92f5d48839795ce37370cad3d44347dd0b` | shell Playwright contract and absent approved screenshot | `7c4dce5210673557ed9d0375d5abb396b5ab710f` |
| `3cc3d3189a861b5f2ec8288a942727a520899c1f` | bounded/deduplicated/persistent feedback tests with no controller | `6b9e4dc58c2f23cd13c01a966439e449e532a0e0` |
| `92586766de9f5363870cfba2ba91326e9ae67aeb` | admin keyboard-order and shared shell behavior assertions | `eaf327f42b8f16cea147ac40881f8f262590f36c` |
| `7471348da77c430baa7e2a52784edf9827f16b4f` | Telegram lifecycle, CSS synchronization, and cleanup tests | `74dcbd066883db2ff2ca41b85f9b546345a4fc71` |
| `929954257980db2d82020a4c898074390b3244e1` | production preview manifest/SW tests before PWA dependencies | `6fd339954dc9b33938a8f459e29476997031000c` |
| `ec4a8072f09d3ec164f5d860d7d8eb1fc22d519c` | sensitive request and offline-navigation policy tests | `3bfdef31e511f462cde97d87355c70dabe085eb9` |
| `9e26f1c6f359fd0e018931e554e40f6c9b9768f7` | explicit update/retry Toast test with no controller | `0975c1b289eea8bdbc0498d47dbc516a729ff23c` |

The initial visual failure is also recorded in `checks/initial-visual-failure.md`. Later red/green cycles tightened the pixel threshold, migrated the wallet dialog, added safe error mapping, added obsolete-cache and offline checks, and explicitly classified cross-origin requests as network-only.

## CI result

GitHub Actions run [31800845957](https://github.com/0x-eth/LPXBOT/actions/runs/31800845957) passed all six jobs for implementation commit `70fe133c1b00fffaad7d174440f585fbad668831`: Quality, Governance, Browser, Contracts, Infrastructure, and Security.
