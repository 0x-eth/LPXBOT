# E-UI

`/wallets` now includes two unframed operational sections:

- Swap quote controls for token pair, exact base-unit input, one of four platforms, slippage, and refresh. States are `idle`, `quoting`, `quoted`, `expired`, `stale`, and `error`.
- Pricing-position controls for a verified source position, two base-unit cost amounts, optional complete USD price tuple, import, fee/liquidity observations, and hidden/withdrawn marking.

The quote result shows exact `amountOut`, integer `minOut`, price impact, estimated gas fee, gas limit, block validity, route endpoints, and countdown. The pricing row distinguishes chain-observed fees from collected revenue and shows missing/stale USD state without inference.

There are no approve, execute, sign, broadcast, collect, decrease, or chain-write controls. Async commands keep keyboard focus by using guarded `aria-disabled` state. The P05-03 Playwright test passed in desktop and mobile projects, with Enter activation, focus retention, all quote states, hidden behavior, no horizontal overflow, and zero serious/critical Axe violations.

Evidence: `tests/e2e/p05-03-swap-pricing.spec.ts` and `tests/p05-swap-pricing-client.test.ts`.
