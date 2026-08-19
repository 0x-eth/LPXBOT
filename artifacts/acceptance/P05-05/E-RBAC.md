# P05-05 E-RBAC

Preview and submit resolve `walletId` through the authenticated custody-wallet boundary and pass tenant/user/session ownership into every store call. Operation GET is scoped by `operationId + tenantId + userId`; knowing another operation UUID does not grant read access. The PostgreSQL foreign keys and ownership unique key preserve the same tenant/user scope for idempotency records and audit rows.

HTTP and service tests cover missing authentication, foreign tenant, foreign user, unknown wallet, mismatched wallet request, and foreign operation GET. These return the stable not-found/forbidden envelope without revealing whether the foreign wallet or operation exists. The Signer independently authorizes the stored operation, wallet, fencing token, and active plan rather than trusting API ownership claims.

The UI never accepts a wallet address or operation ID from free-form user input; it receives the already owned `CustodyWallet` selected by the wallet page. Browser operation polling uses only the operation ID returned by the successful authenticated submit response.
