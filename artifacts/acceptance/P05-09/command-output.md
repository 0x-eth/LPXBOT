# P05-09 Command Output

| Command / CI job equivalent | Result |
|---|---|
| `pnpm format:check` | passed; all repository files match Prettier style |
| `pnpm lint` | passed; 16/16 workspace packages plus scripts/tests |
| `pnpm typecheck` | passed; 24/24 tasks |
| `pnpm build` (via `pnpm test`) | passed; 16/16 workspace packages |
| `pnpm test` | passed; 187/187 Vitest files with 1022/1022 tests and 194/194 governance tests |
| `pnpm test:postgres` | passed; 33 files / 121 tests, 8 files / 8 tests skipped |
| `pnpm test:anvil` | passed; 8 files / 8 tests on fresh non-forked Anvil chainId 31337 |
| `forge test -vvv` | passed; 6 Foundry suites / 29 tests, including 256-run WalletHelperV1 invariants and WalletHelperV2 closed atomic-liquidity coverage |
| `pnpm exec playwright test tests/e2e/p05-09-local-helper-upgrade.spec.ts` | passed; 4/4 desktop/mobile cases covering completed upgrade, replacement lineage, operation query, manual recovery, Axe, and overflow |
| `pnpm check:all` | passed; baseline, 196/196 traceability, docs, 40 acceptance manifests, and P00/P02/P03/P04/P05 reference gates |
| `node --test tests/governance/p05-09-completion.test.mjs` | passed after finalization; 7/7 completion tests |
| `pnpm finalize:p05-09` | passed; 16 P05-09 files checksummed and P05-02 through P05-08 byte-identical to baseline `9e520339f7c3a975a7f5d4370a28ee0ca59a28bb` |

Execution evidence: a fresh local V1 binding upgrades by CREATE to the independently frozen WalletHelperV2, verifies owner/runtime/ABI/selectors/adapter/Permit2/Token identities, sweeps native plus two known Tokens from V1, performs a clean final rescan, and atomically compare-and-swaps V1 `superseded` with V2 `active`. Restart recovery does not replay confirmed deployment or sweep work; fee replacement preserves init code, target version, nonce, owner, and plan digest. Nonzero allowance, NFT custody, and unknown Token inventory enter `manual-recovery-required` without arbitrary calldata. Atomic liquidity, BSC, testnet, and production signatures/broadcasts are 0; real-fund operations are 0.
