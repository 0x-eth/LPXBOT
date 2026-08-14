# E-RBAC: Login wallet identity and ownership evidence

## Account policy

- A verified login-wallet address is an external authentication identity only. It supplies no role, tier, status, region, chain entitlement, or maintenance bypass.
- An unknown address atomically creates exactly one local `user` / `normal` account with status `pending`, no profile fields, and no allowed chains.
- Wallet login passes the resolved account through the existing P01-02 `authorizeAccount` policy. Active users can proceed; pending, rejected, banned, region-blocked, and maintenance states retain their stable server-authoritative responses.
- Session issuance and HttpOnly cookie handling reuse the existing P01-02 boundary. The API never accepts client-supplied role or account status.

## Link ownership

- Link challenge creation, link consumption, listing, and deletion derive `userId` from the current authenticated session.
- A link challenge includes both `purpose=link` and the session user ID. Login challenges have `purpose=login` and no user ID.
- PostgreSQL enforces one owner per 20-byte address. An address cannot be linked to a second user, including concurrent attempts.
- Listing filters by `user_id` and returns only a masked view. It exposes no full address.
- Deletion performs the `linkId` and `userId` ownership test in the `DELETE` query. Cross-user deletion returns stable `LINK_NOT_FOUND` behavior.
- The same transaction locks the user and refuses removal when the wallet is the account's final login method. A verified Telegram identity or another login wallet permits removal.

## Authority boundary

The `auth_login_wallets` name and database comments state that these rows confer no transaction or signer authority. Web and API authentication modules do not import the signer package, create transaction-wallet records, store keys or mnemonics, or request transaction RPC methods.

P01-03 Telegram semantics were not changed. Its acceptance tree remains `3ce5c7bc9d67f1f4b50c0da23085b65fe200b5f5`. All observations are `local-fixture-verified`.
