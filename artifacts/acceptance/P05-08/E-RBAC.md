# P05-08 E-RBAC

All scan, preview, submit, batch, and single-operation reads are tenant/user scoped. Wallet lookup requires the authenticated user to own a ready synthetic custody wallet. Snapshot, preview, idempotency, batch, operation, Helper binding, and nonce reservations carry that scope; the API never trusts wallet address, Helper address, or owner address from the browser.

HTTP tests reject unauthenticated requests, another user's wallet, another tenant/user batch, and cross-wallet operation lookup. The PostgreSQL lifecycle persists two user/wallet scopes and proves batch and operation reads return not-found outside the owning scope. One batch cannot combine wallets or Helpers, and a live batch uniqueness guard prevents concurrent funding recovery for the same wallet.

Sweep submission requires a stable idempotency key and fresh reauthentication. The isolated Signer receives only a server-authenticated typed operation envelope over loopback. Its authorizer reloads the tenant/user/wallet operation, current plan, nonce/fencing reservation, Helper binding, and active transaction generation from PostgreSQL before signing; browser authority cannot select target, recipient, amount, fee, or calldata.

The BSC chainId 56 residual surface remains an authenticated read-only reader. It has no sweep preview/submit route and its panel has no execution control. Local HELPER-06 authority does not inherit to BSC, testnet, production, or real assets.
