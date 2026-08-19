# P05-07 E-OPS

Runtime composition fails closed. Local snapshot discovery and preview require explicit snapshot stores and dual-provider local chain readers. Signing/recovery additionally require PostgreSQL operation/recovery repositories, the isolated loopback Signer, custody material, local RPC providers, and Worker composition. Registry validation accepts only non-forked Anvil chainId 31337, synthetic wallets, exact TestOnlyERC20/TestOnlyWBNB hashes, TestOnlyPositionManagerV2, platforms 1/2/4/5, and service fee 0 bps.

`execution-gate.json` records local `OPEN` only for POS-02 collect and POS-03 removal. The BSC chainId 56 page remains read-only; BSC, testnet, and production execution are `CLOSED`, with 0 signatures, 0 broadcasts, and 0 real-fund operations. Their Signer and Worker queues have no local Position route. Rollback advances to `p05-local-position-execution-disabled-v1`, removes new preview/submit composition, and preserves append-only snapshot, plan, transaction, receipt, proceeds, pricing, reconciliation, Outbox, and audit evidence.

Operational diagnosis uses operation/step state, ordered cursor, nonce and fencing reservations, active transaction generation, replacement authorization, Outbox lease/attempt counters, reconciliation reason, canonical receipt evidence, fee/principal proceeds events, and final pricing completion. The unified GET response exposes stable step/replacement state without calldata, raw signed transactions, custody material, or Signer credentials.

Recovery runbooks never manually replay a confirmed decrease. Operators reconcile chain evidence, then resume collect or burn from the persisted cursor. Principal remains unavailable until canonical collect. A burn retry is allowed only after live liquidity=0, owed0=0, owed1=0, owner=wallet, and the original user selection are all revalidated.

P05-02 through P05-06 acceptance is checked byte-for-byte against `c71791936d6382879e4c8342c50852030de9ab18` by both the completion test and finalize script. HELPER-03, HELPER-04, and HELPER-06 remain planned; single-token Swap, rebalance, migrate, and production PositionManager execution remain excluded.
