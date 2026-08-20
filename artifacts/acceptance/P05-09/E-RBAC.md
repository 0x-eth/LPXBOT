# P05-09 E-RBAC

Preview, submit, operation, and latest-operation reads require authentication and are scoped by tenant, user, and owned ready custody wallet. The API resolves the wallet address and WalletHelperV1 binding server-side; it never trusts browser-supplied owner, Helper, target, version, nonce, recipient, Registry, or fee facts.

Submission requires fresh reauthentication and a stable idempotency key. The isolated loopback Signer receives a typed deployment envelope only after its PostgreSQL authorizer reloads the operation, plan, source binding, nonce/fencing reservation, active generation, wallet identity, V2 artifact identity, and optional replacement authorization. The authorizer rejects a wrong tenant/user/wallet, cursor, generation, plan digest, init code, owner, target, nonce, Registry, or fee tuple.

Operation and latest queries return not-found for another tenant or user. The P05-08 sweep bridge accepts only the owning upgrade operation at `sweep-v1`, records its provenance, and blocks an ordinary or forged sweep while upgrade work is live. Existing Swap, Position, Helper deployment, and residual sweep stores also reject new wallet funding work while a Helper upgrade is live.

No browser or public API route reaches the Signer directly. ChainId 56 remains read-only, and local HELPER-03 authority does not inherit to BSC, testnet, production, public RPC, real assets, or HELPER-04 atomic liquidity execution.
