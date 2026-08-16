# E-SEC

- `BSC_RPC_URL` is accepted only from the environment and is held in a JavaScript private field.
- Production configuration rejects `rpcUrl` and `BSC_RPC_URL` properties.
- JSON serialization of initialized production adapters does not expose the RPC URL.
- Runtime and capture transports allow exactly five read-only RPC methods.
- Signing, personal, send transaction, send raw transaction, broadcast and funds operations are rejected before transport or absent.
- Live capture requires `P02_03_CAPTURE_LIVE_BSC=1`; offline CI does not access public RPC.
- Golden and acceptance files contain no RPC endpoint or production secret.

The full-history Gitleaks scan passes. Its only new false-positive class was the literal `token0`/`token1` field paired with public ERC-20 addresses in chain golden files; the allowlist is restricted to the P02-03 golden paths, the generic-key rule, those exact field names and lowercase 20-byte addresses. `pnpm audit:dependencies` reports no known vulnerabilities.
