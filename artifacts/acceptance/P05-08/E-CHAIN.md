# P05-08 E-CHAIN

`tests/integration/anvil-local-helper-sweep.integration.ts` starts a fresh non-forked Anvil chainId 31337 and deploys the P05-05 synthetic contract sequence. The test derives the actual immutable WalletHelperV1 instance runtime hash, verifies `owner()`, and binds that instance to the synthetic custody wallet before any preview or signature. TestOnlyERC20, TestOnlyWBNB, adapter, router, Permit2, and manager addresses/runtime hashes must match `p05-local-helper-sweep-v2`.

The chain run completes four API batches: a mixed native + TestOnlyERC20 + WBNB batch, then one single-asset batch for each asset. This produces six independently typed, nonce-reserved, isolated-Signer broadcasts and six canonical receipts. Each transaction target is the bound Helper; token data is exactly `sweepToken(planDigest, token, snapshotBalance)` and native data is exactly `sweepNative(planDigest, snapshotBalance)`. Client calldata is never accepted.

Two independent local providers must agree on transaction hash, block number/hash, receipt status, confirmations, and semantic logs. Token success requires the canonical `Transfer(helper, owner, amount)` event, exact Helper decrease, exact owner increase, and final Helper token balance at or below dust. Native success requires final Helper native balance at or below dust and owner net change equal to swept amount minus the gas paid by the owner transaction.

Every batch ends with a new canonical full scan. Recovery to active requires all three balances at or below dust, every allowance zero, NFT custody empty, unknown Token inventory empty, coverage complete, and the Helper code hash plus immutable owner unchanged. BSC, testnet, and production signatures/broadcasts are 0; real-fund operations are 0.
