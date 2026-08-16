# P02-03 capture methodology

## Evidence boundary

- Chain: BNB Smart Chain, `chainId 56` only.
- Risk: R1 read-only public chain data and local files/databases.
- ABI inputs: pinned official Solidity interfaces listed in `source-manifest.json`.
- Deployment inputs: pinned official deployment documents/artifacts plus verified BscScan contract captures.
- Historical material under `docs/research` was not promoted into this evidence set.

## Live capture

Live capture is an explicit maintenance action:

```bash
BSC_RPC_URL=... P02_03_CAPTURE_LIVE_BSC=1 pnpm capture:p02-03
```

The script exits before RPC access unless `P02_03_CAPTURE_LIVE_BSC=1` is present. `BSC_RPC_URL` is read only from the process environment and is never printed or written to an artifact. The capture transport permits only:

- `eth_chainId`
- `eth_getLogs`
- `eth_getBlockByNumber`
- `eth_getTransactionReceipt`
- `eth_getCode`

No signing, personal, transaction submission, raw transaction submission, broadcast, target-site write or funds method exists in the source or fixtures. Requests use a 15-second timeout and three bounded attempts.

## Golden selection

Each supported protocol/event pair is fixed by transaction hash, log index, emitting address and topic0 in `scripts/capture-p02-03-golden.mjs`. Each raw artifact contains:

- the exact log and `removed` flag;
- the full transaction receipt;
- a projected block header including `hash`, `parentHash`, `timestamp`, roots and gas fields;
- the event contract runtime code hash observed at the capture head and its observation block;
- the capture timestamp;
- prerequisite V3 `PoolCreated` or V4 `Initialize` evidence when the event needs a catalog identity;
- receipt token-delta evidence for amount/liquidity direction.

V3 identity is the lowercase pool address emitted by the registered factory. V4 identity is the PoolId plus protocol-specific PoolKey. Uniswap V4 PoolId is recomputed over `(currency0,currency1,fee,tickSpacing,hooks)`; PancakeSwap V4 is recomputed over `(currency0,currency1,hooks,poolManager,fee,parameters)`. A mismatch is quarantined.

## Amount signs

- V3 Swap values are retained exactly from the signed ABI fields and equal the pool's receipt token deltas.
- V3 Mint is positive pool inflow.
- V3 Burn principal and liquidity are normalized negative; the paired Collect and receipt outflow can include accrued fees.
- V3 Collect is negative pool outflow and matches the receipt exactly.
- V4 Swap values are retained exactly from BalanceDelta and are the inverse of custody flow. Uniswap custody is PoolManager; Pancake custody is the official Vault.
- V4 ModifyLiquidity uses positive as add and negative as remove. The captured positive examples are corroborated by custody inflow.
- Events carry no inferred NFT or position token identifier; `positionId` remains `null`.

## Offline regeneration

Normal tests never contact a public RPC. The normalized fixtures and sign evidence regenerate locally:

```bash
pnpm --filter @lpbot/chain-registry build
pnpm --filter @lpbot/chain-adapters build
pnpm generate:p02-03-golden
pnpm annotate:p02-03-signs
pnpm exec vitest run tests/production-chain-decoder.test.ts tests/viem-bsc-log-source.test.ts
```

`sha256sums.txt` covers the acceptance tree except itself. The capture RPC URL is absent from every artifact.

## Remaining boundary

P02-03 does not select a BSC confirmation/finality depth. `GAP-FINALITY-DEPTH` remains unresolved, so the work item is `accepted-with-gaps`.
