# P05-07 E-UI

The wallet page loads authenticated current local snapshots and renders the Position execution panel only when the local chainId 31337 gate is open. The chainId 56/BSC view remains read-only: it has no collect/remove preview, signing, confirmation, or broadcast entry.

For the current snapshot, the panel exposes Collect and Remove tabs. Remove supports keyboard-operable 1/25/50/99/100 presets plus a bounded numeric percent input, slippage input, and an `空仓后 Burn NFT` checkbox that is enabled only at 100%. Preview shows expected token0/token1 delta, fee proceeds, decrease principal, remaining liquidity, minimum amounts, aggregate gas/fee cap, deadline, Manager, and each ordered step before confirmation.

The operation view polls `GET /api/chain-operations/:operationId` and renders queued, signing, broadcast, pending, reconciling, succeeded, and failed states. Every step shows ordinal, kind, nonce, fee ceiling, failure code, transaction generation, active/replaced lineage, and cursor status. A confirmed decrease is not presented as withdrawn while collect is pending; a burn retry remains visible after collect succeeds.

`tests/e2e/p05-07-local-position-execution.spec.ts` runs 8 desktop/mobile cases covering zero-owed Collect, duplicate Enter submission protection, full decrease/collect/burn recovery, collect replacement lineage, burn retry, all five percentage controls, partial-burn denial, strict payload inspection, keyboard focus/activation, serious/critical Axe accessibility checks, horizontal overflow, closed-gate hiding, and visual regression. The request inspection confirms no Manager, target, selector, calldata, recipient, liquidity delta, min/max amount, or fee field crosses the browser boundary.
