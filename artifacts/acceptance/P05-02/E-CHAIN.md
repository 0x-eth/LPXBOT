# E-CHAIN

The Registry is fixed to `p05-bsc-execution-v1`, chainId 56, and `executionEnabled: false`. It identifies four independent deployments: platformId 1 Uniswap V3, 2 PancakeSwap V3, 4 Uniswap V4, and 5 PancakeSwap V4. Each deployment owns an independent Position adapter and ABI hash; V3 identity is a pool address and V4 identity is a pool ID.

The controlled server RPC client admits exactly `eth_call`, `eth_getCode`, `eth_getLogs`, `eth_getBalance`, `eth_blockNumber`, `eth_getBlockByNumber`, and `eth_getBlockByHash`. Calls are pinned to one block number/hash, and the canonical hash is read again after the scan. A changed hash fails the snapshot rather than publishing mixed-block data.

The local Anvil suite ran with chainId 56 and passed 2 tests. It observed only the seven allowed read methods and confirmed a zero transaction count. CI fixtures are frozen or local and do not access a public RPC endpoint. Because this work item is read-only, raw transactions, receipts, write logs, before/after fund balances, and approval mutations are not applicable evidence.

Final execution counters: signing 0; broadcast 0; deployment 0; upgrade 0; sweep 0; chain writes 0; real-fund operations 0.

Production RPC runner wiring and live Registry runtime-code-hash verification remain unresolved. This evidence is local-fixture-verified only.
