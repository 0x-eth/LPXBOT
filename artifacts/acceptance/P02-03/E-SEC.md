# E-SEC

- `BSC_RPC_URL` is accepted only from the environment and is held in a JavaScript private field.
- Production configuration rejects `rpcUrl` and `BSC_RPC_URL` properties.
- JSON serialization of initialized production adapters does not expose the RPC URL.
- Runtime and capture transports allow exactly five read-only RPC methods.
- Signing, personal, send transaction, send raw transaction, broadcast and funds operations are rejected before transport or absent.
- Live capture requires `P02_03_CAPTURE_LIVE_BSC=1`; offline CI does not access public RPC.
- Golden and acceptance files contain no RPC endpoint or production secret.

Security gate results are recorded in `command-output.md` after Gitleaks and dependency audit execution.
