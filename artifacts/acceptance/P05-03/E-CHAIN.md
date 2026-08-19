# E-CHAIN

The quote Registry is fixed to chainId 56, Registry `p05-bsc-execution-v1`, platformIds 1/2/4/5, and three controlled token addresses. Each platform has an independent server-side router, spender, selector, and runtime code hash. The router selector allowlist remains empty, so a valid quote cannot become an executable operation.

`BscSwapQuoteAdapter` validates canonical base-unit input, token inequality, slippage `0..500`, Registry identity, runtime code hash, route endpoints, pool path, provider snapshot expiry, response size, gas arithmetic, and integer `minOut`. It computes `LPXBOT_SWAP_QUOTE` v1 over wallet, Registry, route, gas, block, and time fields. Any field mutation fails digest verification.

CI quote behavior uses only `DeterministicSwapQuoteProvider`; its environment factory permits that fixture only under `NODE_ENV=test`. Production with no source returns `null`, and the API fails closed. The local Anvil suite remains restricted to controlled read methods and zero transactions; no public RPC or real funds are used.

Final counters: signing 0; broadcast 0; chain writes 0; real-fund operations 0; production calldata generation 0. Raw calldata is not generated, accepted, returned, or stored.

Evidence: `tests/p05-swap-quote-adapter.test.ts`, `tests/p05-swap-quote-api.test.ts`, and `tests/integration/anvil-position-helper-read.integration.ts`.
