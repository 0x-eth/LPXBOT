# P05-06 E-OPS

Runtime composition is fail closed. Local Swap quote and preview require explicit PostgreSQL stores plus local chain readers. Signing and recovery additionally require the isolated loopback Signer, token, local RPC providers, recovery repository, and Worker composition. Registry validation permits only non-forked Anvil chainId 31337, exact deterministic code identities, synthetic wallets, TestOnlyERC20/WBNB, and service fee 0 bps.

`execution-gate.json` records local `OPEN` only for SWAP-02 under `p05-local-swap-execution-v2`. BSC quote execution, testnet, and production remain `CLOSED`; their signer and Worker queues have no route. Rollback disables new quote/preview/submit composition and advances to `p05-local-swap-execution-disabled-v1` while preserving append-only quote, audit, transaction, reconciliation, and receipt evidence.

Operational diagnosis uses local operation/step states, nonce and fencing assignments, active transaction generation, replacement authorization, Outbox lease/attempt counters, reconciliation cases, append-only receipt evidence, and audit actions. The unified GET endpoint exposes stable operation and replacement status without calldata, raw signed transactions, Permit2 signatures, custody material, or Signer credentials.

Local evidence contains 3 Swap operations and 7 canonical step receipts: direct success, Permit2 success, and approve-success/Swap-revert/cleanup-success. Testnet and production signatures, broadcasts, and real-fund operations remain 0. POS-02, POS-03, HELPER-03, HELPER-04, and HELPER-06 remain planned.
