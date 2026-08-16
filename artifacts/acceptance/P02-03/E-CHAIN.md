# E-CHAIN

## Deployment registry

The four chain-56 deployments are pinned in `deployment-registry.json` with official source references, creation transactions/blocks, lowercase storage addresses, EIP-55 display addresses, runtime code hashes, ABI hashes and open-ended valid ranges.

Startup verification calls `eth_chainId` and `eth_getCode(address, latest)`. A missing deployment, empty code or hash mismatch disables only that protocol. `chainAccessConfigurationComplete` remains separate from `marketDecoderComplete`.

## Decoder evidence

- 16 supported protocol/event combinations have raw and normalized chain golden files.
- V3 requires a factory-proven pool catalog entry before pool log decoding.
- V4 requires a PoolManager `Initialize` entry and recomputes the protocol-specific PoolId.
- Official topic0 selectors are asserted byte-for-byte.
- Unknown topics, wrong address/chain/protocol, ABI conflict, unregistered identity, malformed data and block-range violations are quarantined and rejected.

Focused command:

```text
pnpm exec vitest run tests/protocol-deployment-registry.test.ts tests/production-chain-decoder.test.ts tests/production-indexer-startup.test.ts
```
