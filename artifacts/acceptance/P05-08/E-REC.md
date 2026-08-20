# P05-08 E-REC

Each asset is an independent durable operation and cursor. A successful asset is terminal and is never replayed even when another asset fails, drops, is replaced, or the Worker restarts. Failed or dropped assets resume from their own cursor. The PostgreSQL lifecycle test abandons and reclaims work after partial success, then proves the confirmed operation ID is not delivered again.

Replacement is per asset and fee-only. It retains batch, operation, asset/token, snapshot amount, immutable owner recipient, nonce, fencing token, Registry/snapshot/plan/semantic/data digests, Helper target, selector, calldata, deadline, and gas limit while strictly increasing max fee and priority fee within the frozen cap. Original, dropped/replaced, and active generations remain queryable as one lineage.

The observer treats dropped, reorged, underconfirmed, provider-divergent, mismatched Transfer, wrong balance delta, wrong gas-adjusted native delta, identity drift, and dust failure as uncertain or failed evidence; none can silently advance a cursor. Dual-provider canonical lineage chooses only the matching receipt/block winner. A reverted receipt is not finalized before the configured confirmation boundary.

After all operations succeed, the Worker enters `reconciling` and forces a complete canonical rescan. Binding recovery from degraded to active occurs only when balances, allowances, NFT custody, unknown Token inventory, coverage, runtime code hash, owner, component identities, and Registry all pass. Nonzero allowance, NFT custody, or unknown Token produces `manual-recovery-required`; WalletHelperV1 has no invented rescue calldata.

`tests/p05-local-helper-sweep-recovery.test.ts` covers token Transfer and native gas reconciliation, canonical confirmations, dust/identity/reorg/provider divergence, dropped detection, restart, failed-asset retry, replacement immutability, and full rescan. The real Anvil and PostgreSQL suites provide chain and durable lifecycle closure.
