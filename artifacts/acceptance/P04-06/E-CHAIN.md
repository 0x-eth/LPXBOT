# P04-06 Chain Evidence

All write-chain acceptance used a fresh loopback Anvil process on chain ID 31337, Anvil's documented development account, a synthetic recipient, and the local `TestOnlyERC20` fixture. No public RPC, testnet, mainnet, or real funds were used.

The local closure signed and broadcast two transactions through viem and the dedicated raw-transaction delivery port:

- Native transfer: `1000000000000000` base units. Sender delta equaled amount plus `gasUsed * effectiveGasPrice`; recipient delta equaled the exact amount.
- ERC-20 transfer: `123456` base units through only `transfer(address,uint256)`. Sender and recipient token deltas each reconciled exactly, the second nonce equaled the first nonce plus one, receipt status was success, transaction target was the fixture token, and the Transfer log reconciled.

Two independently named local observers agreed on the canonical block, transaction hash, sender, target, nonce, receipt status, balance changes, and Transfer log. The final account transaction count equaled the ERC-20 nonce plus one. Native transfers used empty calldata; ERC-20 calldata was derived from the fixed transfer selector and arguments, never accepted from the API.

Serialization and secp256k1 signing use the maintained viem account implementation. No RLP, transaction signing, or signature recovery algorithm was handwritten. Raw transaction bytes existed only between the signer and dedicated broadcast adapter and were cleared after delivery; they did not enter PostgreSQL, Redis, queues, logs, audit, telemetry, or API responses.

Results: `pnpm test:anvil` passed 1/1 local chain integration test. `forge fmt --check`, `forge build`, and `pnpm test:contracts` passed 4/4 contract tests. Public RPC calls: 0. Non-local signing and broadcast calls: 0.
