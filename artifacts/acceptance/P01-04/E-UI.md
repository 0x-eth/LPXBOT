# E-UI: Login wallet browser workflows

## Login

- The login page exposes a real Wallet action wired to the nonce, `personal_sign`, login, cookie-session, and protected-route flow. There is no simulated success control.
- The EIP-1193 adapter is inert until the user activates Wallet or Link wallet. It then uses only `eth_requestAccounts`, `eth_accounts`, `eth_chainId`, and `personal_sign`.
- Account and chain are checked immediately before and after signing. Provider absence, user rejection, interrupted requests, invalid responses, account changes, and chain changes produce stable UI errors and leave authentication retryable.
- The browser never requests a chain change, a transaction, transaction signing, or account funding.

## Settings

- `/settings` lists login wallets with masked addresses, labels, and dates.
- Binding accepts an optional label, obtains a session-bound link challenge, signs it, and refreshes the visible list.
- Removal requires an explicit confirmation dialog. The server remains authoritative for ownership and last-login-method protection.
- Labels render as React text. The Playwright fixture verifies that a `<script>`-shaped label is displayed literally and creates no script element.

## Browser verification

`pnpm test:e2e` passed 38 Chromium tests across:

- Desktop at 1440 x 900.
- Mobile at 390 x 844.
- Successful wallet login and protected-route convergence.
- First-signature rejection followed by a successful retry.
- Missing provider handling after user activation.
- Wallet list, labeled binding, escaped output, deletion confirmation, and removal.
- Empty `localStorage` and `sessionStorage` after authentication.
- Explicit assertions that no transaction, transaction-signing, chain-add, or chain-switch RPC method was called.
- Keyboard navigation and axe checks in the complete authentication suite, with no serious or critical violations in the asserted wallet flow.

Visual review found no blank content, clipping, overlap, or mobile overflow in:

- `ui/wallet-login-chromium-desktop.png`
- `ui/wallet-login-chromium-mobile.png`
- `ui/settings-chromium-desktop.png`
- `ui/settings-chromium-mobile.png`

Evidence is `local-fixture-verified`. The provider, address, signature, nonce response, and API responses were Playwright fixtures; no real wallet or external RPC was used.
