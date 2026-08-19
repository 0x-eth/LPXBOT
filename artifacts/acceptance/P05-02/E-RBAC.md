# E-RBAC

All four HTTP surfaces require an active session and a custody-wallet match for the current user. An address in the path is not authority. Cross-user access, an unknown wallet, a mismatched wallet ID in a residual request, or chainId other than 56 is denied before chain reads or snapshot persistence.

Helper identity can enter the store only through the internal `WalletHelperBindingStore.bindTrusted` interface using a `deployment-result` or `trusted-migration` source. There is no client route for binding an arbitrary Helper. Position approval resolution reads that trusted binding instead of accepting a user-supplied approval target.

Residual inputs are bounded to the versioned Registry allowlist, verified position tokens, wallet-controlled token registry, registered spenders, and registered NFT Managers. Requests containing token, spender, Manager, target, provider, RPC URL, calldata, Helper address, or allowlist fields are rejected. Ordinary users cannot read or trigger scans for another user's wallet.

Evidence: ownership and cross-user cases in `tests/p05-position-api.test.ts`, `tests/p05-helper-api.test.ts`, `tests/p05-helper-read-model.test.ts`, and `tests/integration/postgres-helper-read-store.integration.ts`.
