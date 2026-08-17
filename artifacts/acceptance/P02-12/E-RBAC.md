# E-RBAC

- Every provenance read requires a valid session. Personal history derives `userId` only from the authenticated session and never accepts another user selector.
- Both administrator creator routes check the trusted admin role before any attribution lookup. An ordinary user receives 403 `ADMIN_REQUIRED`, and focused tests prove the attribution query count remains zero.
- Administrator allowed and denied queries write only an action, actor/session IDs, identity count, SHA-256 identity digest, outcome, request ID, result code, and timestamp. Raw queried identities are absent from audit rows.
- The oversized-body audit uses identity count zero and the empty-set digest because untrusted body content is neither parsed nor retained.
- Creator profile, Telegram ID, creator wallet, and transaction hash are serialized only to the owning user's history response or an authorized administrator attribution response.
- Deleted users retain a provenance record with `creatorProfile: null`; the ledger is not erased or reassigned to another identity.
- Ordinary-user UI renders no creator-marker node and sends no `/api/admin/pool-creators` request.

