# P05-06 E-CHAIN

`tests/integration/anvil-local-swap-execution.integration.ts` runs the real API-to-chain closure against a fresh, non-forked Anvil chainId 31337 and PostgreSQL. It deploys only deterministic TestOnlyERC20, TestOnlyWBNB, TestOnlyPermit2, TestOnlySwapRouter, TestOnlyPositionManager, LocalExecutionAdapter, and the P05-05 per-wallet WalletHelperV1. Runtime code hashes for every token and component must match `p05-local-swap-execution-v2` before quote or signing.

The run creates three local Swap operations and records seven canonical step receipts:

| Path | Ordered result | Closure |
|---|---|---|
| direct | approve succeeded -> swap succeeded -> cleanup skipped | owner output delta is at least minOut; exact Helper allowance returns to zero |
| Permit2 | approve succeeded -> swap succeeded -> cleanup skipped | Permit2 authorization is consumed, remaining amount is zero, and Permit2 nonce advances to 1 |
| reverted Swap | approve succeeded -> swap reverted -> cleanup succeeded | operation is reconciling while cleanup is pending, then becomes failed only after owner-to-Helper allowance is zero |

The direct path deliberately abandons a claimed lease and constructs new Worker instances before receipt observation, proving restart recovery rather than an in-memory happy path. Successful Swap closure verifies canonical block and transaction identity, receipt success, owner tokenOut before/after delta, minOut, matching `PlanExecuted` and `SwapExecuted`, Helper replay recording, owner-to-spender allowance zero, Helper-to-adapter allowance zero, adapter-to-router allowance zero, and bounded Helper input/output dust.

Local Swap step signatures/broadcasts: 7/7. Local Permit2 authorization signatures: 1. Local operations: 3. Canonical step receipts: 7. Testnet signatures/broadcasts: 0/0. Production signatures/broadcasts: 0/0. Real-fund operations: 0.
