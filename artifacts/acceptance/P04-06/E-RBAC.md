# P04-06 RBAC Evidence

- All three transfer routes require an authenticated session.
- Wallet lookup is scoped by authenticated user and wallet ID before preview, submit, or get; another user's operation returns not found.
- The wallet must be owned, ready/unlocked for the active mode, and allowed by the account's current chain-access policy.
- Local auto-execution additionally requires the operator-configured API local-chain allowlist. Missing configuration fails closed; non-local writes remain `ready-for-approval`.
- The current token registry definition, deployed code, bounded standard metadata, and fee-on-transfer support flag are checked before ERC-20 preview.
- Own-wallet/self-transfer is rejected. Known external addresses reuse the address-book classification without another password. New external addresses require the dedicated P04-04 security-password verifier.
- Signer authorization independently repeats tenant/user/wallet, chain, unlock-session, immutable-plan, fee, deadline, and policy-digest checks. API authorization alone cannot create signing capability.

Real API tests cover unauthenticated and cross-user access, ownership, no-store responses, allowed local policy, idempotent replay/conflict, wrong media type, bounded secret ingress, and password exclusion from logs. PostgreSQL tests reject a replacement whose recipient differs from the authorized plan.
