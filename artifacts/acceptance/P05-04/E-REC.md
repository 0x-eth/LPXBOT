# P05-04 E-REC

The typed plan digest binds wallet, chain, nonce, Registry version/digest/range/rollback, target, selector, value, runtime code hash, deadline, fee terms, quote/snapshot digests, token policy, and type-specific amounts and recipients. HelperDeploymentPlan additionally binds owner, adapter, Permit2, constructor arguments, creation code, expected address, and runtime hash.

Local Anvil proves four recovery boundaries:

- A successful plan digest cannot execute again; the duplicate simulation is rejected before further balance change.
- Re-submitting the same signed raw transaction yields the same hash and the second transport submission is rejected.
- A higher-fee transaction with the same nonce replaces the pending transaction; only the replacement has a successful receipt.
- After state dump, Anvil restart, and reload, Helper code hash, immutable owner, executed plan mapping, and wallet nonce match the pre-restart state.

The deliberately reverted minOut transaction preserves all captured token balances, internal allowances, and the unexecuted plan marker. Because the prior exact owner-to-Helper allowance also remains unchanged under EVM atomicity, the fixture performs and verifies a separate zero-reset recovery transaction. Testnet/mainnet recovery activity is 0.
