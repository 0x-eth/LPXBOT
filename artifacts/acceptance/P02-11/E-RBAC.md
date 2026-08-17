# E-RBAC

- Both blocklist routes authenticate before any store read or mutation. Anonymous requests receive 401 and do not touch the store.
- User identity comes only from the verified session; no request body, query, pool identity, Token identity, label, or intent field can select another user's blocklist.
- PostgreSQL state and entry keys include the owning user and cascade from that user's row. Reads and mutations always bind `session.userId` as the first store selector.
- The mutation rate key is the authenticated session ID. Changing an entry identity does not evade the limit or merge another user's quota.
- Blocklist management is a user capability and does not confer admin, chain-management, task-write, monitoring-write, chat-send, signer, or funds permissions.
- Pool action intents contain canonical pool/token selectors only and carry no user ID, role, session token, authorization override, or executable operation.
