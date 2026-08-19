# E-SEC

The RPC URL is read only from the server environment key `BSC_POSITION_READ_RPC_URL`; client target/provider/calldata values never select the endpoint or method. Non-loopback plaintext URLs are rejected. Timeouts, request/response size limits, strict JSON-RPC IDs, hex validation, and method-specific parameter builders bound the transport.

The only admitted methods are `eth_call`, `eth_getCode`, `eth_getLogs`, `eth_getBalance`, `eth_blockNumber`, `eth_getBlockByNumber`, and `eth_getBlockByHash`. There is no generic RPC pass-through. Manager and Helper runtime bytecode is hashed and compared with the versioned Registry before data is trusted.

Position output is validated again at the scanner boundary: owner, manager, platform, generation-specific pool identity, code hash, Registry version, approval observation block, and snapshot block must agree. Cursor payloads are authenticated and tenant-bound. Helper verification compares address, owner, runtime hash, selectors, and same-chain version at one canonical block. Residual tokens cannot be supplied by the caller, and incomplete source coverage fails to `partial`.

Security counters: signing 0; broadcast 0; deployment 0; upgrade 0; sweep 0; chain writes 0; real-fund operations 0. No public RPC call or real-fund access was made. Full-history Gitleaks and dependency-audit results are recorded in `command-output.md`.
