# P05-09 E-CHAIN

`tests/integration/anvil-local-helper-upgrade.integration.ts` starts a fresh non-forked Anvil chainId 31337 and deploys the exact synthetic Token, WBNB, Permit2, router, managers, adapter, and WalletHelperV1 sequence. It funds V1 with native, TestOnlyERC20, and TestOnlyWBNB residuals, derives the actual immutable V1 and V2 instance runtime hashes, and uses two local provider views before any upgrade signature.

The typed upgrade transaction is CREATE with `to=null`, zero value, the frozen WalletHelperV2 init code, owner nonce 1, and the plan-bound fee limit. The canonical deployment receipt address and runtime hash must match the predicted target. Verification reads immutable owner, adapter, Permit2, both Token addresses and code hashes, the complete 18-selector set, ABI hash, selector-set hash, and `ATOMIC_LIQUIDITY_EXECUTION_ENABLED=false`.

The Worker then creates one provenance-bound P05-08 sweep batch and broadcasts three V1 cleanup operations. Native, TestOnlyERC20, and WBNB balances finish at or below dust; allowances are zero, NFT custody and unknown Token inventory are empty, coverage is complete, and no live operation remains. A final canonical rescan precedes the SERIALIZABLE compare-and-swap that leaves V1 `superseded`, V2 `active`, and exactly one active binding for the wallet and chain.

The integration restarts the upgrade and sweep Workers between cursor advances. Completion preserves one V2 deployment transaction and one V1 sweep batch; another restart claims no work and does not change the owner nonce. BSC, testnet, production, forked chains, public RPC, and real funds are not used.

`contracts/test/WalletHelperV2.t.sol` provides owner-only, nonReentrant, zero-service-fee, fixed owner recipient/refund, exact allowance, Permit2, Token code identity, sweep, malicious adapter/token, and atomic-liquidity-closed coverage. The Foundry suite also runs invariant calls against the frozen contract surface.
