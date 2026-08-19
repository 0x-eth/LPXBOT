# P05-07 E-CHAIN

`tests/integration/anvil-local-position-execution.integration.ts` starts a fresh non-forked Anvil chainId 31337 and deploys the existing synthetic contract set plus the new `TestOnlyPositionManagerV2`. The deployed Manager address is fixed to `0xa513e6e4b8f2a923d98304ec87f64353c4d5c853`; its runtime hash must equal `0x6218a887ec7babb0af09bf8e4c71880954fcfeb5872b055e2f858f146bb25106` before any plan is built or signed. TestOnlyPositionManager, LocalExecutionAdapter, WalletHelperV1, and `foundry.toml` remain byte-source identical to baseline.

Platforms 1/2/4/5 cover both V3 and V4 fixture identities. Each platform executes three real paths:

| Path | Ordered chain result | Canonical assertions |
|---|---|---|
| collect | collect | wallet token0/token1 deltas are 11/13; liquidity and NFT owner do not change |
| partial decrease | decrease -> collect | wallet delta remains zero after decrease; owed becomes fee plus principal; collect pays the exact total |
| 100% exit | decrease -> collect -> burn | liquidity and owed become zero before burn; `ownerOf(tokenId)` is absent after burn |

These platform paths produce 24 successful Manager action transactions. Separate live transactions verify 1/25/50/99/100 percentage deltas against liquidity 101, including deterministic floor rounding and exact 100% removal. Simulation rejects recipient injection, non-owner collect, excessive min amounts, and expired deadline. Unknown NFT access reverts through the Manager owner check.

The final V4 scenario runs an opaque API preview/submit plan through dual local providers. Its three plan-derived calldata steps are broadcast with the reserved consecutive nonces, observed from canonical receipts, and reconciled as decrease -> collect -> burn without accepting client calldata. Each decision verifies block/transaction identity, selector, Manager runtime, owner, liquidity/owed transitions, recipient, wallet deltas, and burn postcondition. This yields one local ordered operation closure and three canonical step receipts. BSC, testnet, and production signatures/broadcasts remain 0; real-fund operations remain 0.

Foundry exercises partial principal staging, full exit, optional burn, zero-owed canonical collect idempotency, recipient/non-owner denial, and V4 identity directly against TestOnlyPositionManagerV2. Service fee 0 bps is fixed throughout.
