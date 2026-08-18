# P04-05 UI Evidence

The wallet workspace now provides unframed asset, receive, and address-book sections below the existing custody controls.

- Assets show exact decimal and base-unit balances, block number, current/stale/missing price state, and nullable aggregate valuation.
- Custom token import accepts a contract address, refreshes the model, and exposes deletion only for non-default tokens.
- Receive selects native/default/custom assets, accepts an exact decimal amount, renders the server-returned EIP-681 text, generates a QR image, and offers an icon-only copy action with an accessible label and tooltip.
- Address book lists owned wallets separately from external entries, shows own/known/new classification, accepts the security password only when creating a new external entry, clears the password, and supports revisioned edit/delete actions.
- Settings exposes the `.customRpc` browser-only contract with selected chain, masked URL entry, redacted display, test/clear controls, explicit connection states, and block height.

`tests/e2e/p04-05-wallet-assets.spec.ts` passed 4/4 across desktop and mobile. It exercised exact valuation states, QR image loading, EIP-681 regeneration, token import/delete, new-address classification, signer-password creation, address deletion, opaque iframe RPC testing, API-traffic isolation, redaction, and secret absence from rendered HTML.

The affected P04-02 wallet regression passed 8/8 across desktop and mobile after existing assertions were scoped to the custody section.
