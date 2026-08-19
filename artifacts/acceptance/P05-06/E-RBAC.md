# P05-06 E-RBAC

Quote, preview, submit, and operation GET resolve all records through the authenticated tenant/user boundary. `walletId` is looked up as an owned ready custody wallet; the caller cannot supply a wallet address or Helper address. The active binding lookup is scoped by tenant, user, wallet, chainId, and Helper version. Operation GET requires `operationId + tenantId + userId`, so knowing another operation UUID does not reveal its state.

The PostgreSQL model repeats tenant/user/wallet ownership across quote, preview, operation, step, idempotency, Outbox, reconciliation, audit, and receipt rows, with composite foreign keys to prevent cross-owner associations. The Signer independently loads and authorizes the persisted operation, wallet envelope, active step, fencing token, plan, quote, binding, and Registry; API claims do not grant signing authority.

HTTP and service tests cover missing authentication, missing reauthentication on execute, foreign tenant, foreign user, foreign wallet, mismatched wallet/quote, inactive or foreign Helper binding, and foreign operation GET. These paths fail before signing or broadcast. The browser receives its wallet from the authenticated custody-wallet list and polls only the operation ID returned by submit.
