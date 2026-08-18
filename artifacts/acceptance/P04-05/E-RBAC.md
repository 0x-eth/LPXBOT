# P04-05 RBAC Evidence

- Every API route requires a valid user session.
- Wallet lookup is scoped by authenticated user and wallet ID before token, balance, or receive operations.
- Address-book entry lookup, patch, and delete are scoped by authenticated user; another user's entry is returned as not found.
- Owned-wallet classification uses only the authenticated user's wallet directory.
- Chain registry completeness and current `off/pro/all` access policy are checked before any provider call or write.
- New external address creation requires the P04-04 signer-internal security-password verifier. Own-wallet and duplicate-address branches fail before password verification.
- Default token definitions are immutable registry entries. Only user-owned custom-token rows may be deleted.
- Browser custom RPC chain options are intersected with the authenticated user's allowed chain IDs, while the raw URL remains browser-memory-only and never becomes an API field.

API tests cover unauthenticated requests, cross-user wallet/entry access, disallowed and incomplete chains, wrong secret media type, bad password, own-wallet creation, duplicate entries, stale revisions, and audit outcomes.
