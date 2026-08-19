# P05-07 E-SEC

The self-digesting `p05-local-position-execution-v2` Registry permits only non-forked Anvil chainId 31337, platforms 1/2/4/5, two exact synthetic token identities, TestOnlyPositionManagerV2 address/ABI/runtime hash, collect/decrease/burn selectors, service fee 0 bps, maximum 500 bps slippage, maximum 900 second deadline, and a five-block drift window. BSC, testnet, and production signatures/broadcasts are structurally closed.

Before preview and again before every signature, the API/Signer verifies Registry digest/version, plan/snapshot digest/version, deadline and block window, wallet owner, NFT owner/approval, platform/tokenId, pool/ticks/liquidity/owed, Manager address/ABI/runtime code hash, both token runtime code hashes, step ordinal/nonce/fencing token, target/value/calldata digest, semantic digest, fee ceiling, and active transaction generation. Malicious Manager or token code identity mismatches fail closed.

Ingress tests reject manager, target, selector, calldata, recipient, liquidityDelta, amount0Max, amount1Max, amount0Min, amount1Min, deadline, fee, feeLimit, and serviceFeeBps. API/domain/chain tests cover min amount, slippage, deadline, and recipient injection. Replacement can change only fee fields and cannot alter the position, percent, recipient, nonce, Manager target, calldata, or digests.

Adversarial paths cover non-owner, unknown NFT, wrong platform, malicious manager, and token identity mismatches. Owner/approval changes, stale/reorg/changed snapshot, zero liquidity delta, partial burn, excessive minimums, expired deadlines, wrong collect deltas, premature wallet proceeds, nonempty burn, and missing burn ownership transition are rejected. Zero-owed collect remains canonical and idempotent without fabricating a wallet delta.

The contract diff from baseline contains only `contracts/src/TestOnlyPositionManagerV2.sol` and `contracts/test/TestOnlyPositionManagerV2.t.sol`. Existing TestOnlyPositionManager, LocalExecutionAdapter, WalletHelperV1 sources and compiler configuration remain unchanged; existing P05-06 Registry/hash tests continue to protect their bytecode identities.
