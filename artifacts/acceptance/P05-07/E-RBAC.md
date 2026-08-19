# P05-07 E-RBAC

Local-current, collect preview/submit, remove preview/submit, and unified operation GET resolve records through authenticated tenant, user, and wallet ownership. The caller supplies only a wallet UUID, platform ID, tokenId, and snapshot digest; the server loads the custody wallet address and snapshot. Another tenant/user cannot discover a wallet snapshot, reuse its digest, preview its NFT, submit against it, or query its operation UUID.

Write submission additionally requires the existing reauthentication proof and an idempotency key. The PostgreSQL model repeats tenant/user/wallet ownership across snapshots, previews, operations, steps, idempotency, Outbox, reconciliation, audit, receipt, proceeds, and pricing-completion records. Composite foreign keys prevent cross-owner attachment even if UUIDs or digests are known.

The isolated Signer does not trust API authorization. It reloads the persisted tenant/user operation, custody envelope, active step, nonce reservation, fencing token, plan, snapshot, Registry, Manager and token identities before signing. The Worker only receives persisted step IDs and opaque digests. Raw calldata and custody material are not exposed by the operation query.

HTTP tests cover missing authentication, missing reauthentication, foreign user/wallet current-snapshot lookup, foreign operation GET, injected query parameters, and closed-gate access. Service/store tests preserve wallet-scoped idempotency and reject mismatched wallet/platform/token/snapshot facts before signing or broadcast.
