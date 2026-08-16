# E-RBAC

- All three address-remark routes use the existing session resolver and `authorizeAccount` boundary, including account status, maintenance, region, and role policy. Anonymous or expired sessions receive the standard authentication envelope.
- Personal ownership is derived only from `session.userId`. PUT has an exact field allowlist and cannot accept a user identifier; DELETE predicates include session user, chain, and canonical address.
- PostgreSQL enforces one row per user/chain/address. Concurrent upserts retain one personal row, and deleting one user's row cannot remove another user's row.
- Shared voting groups anonymous labels by chain/address/label. The winner is vote count descending, then `COLLATE "C"` label ascending. Responses omit contributor user IDs, session IDs, profile data, and audit data.
- Personal labels take display priority over shared winners. Watch state is personal and is never derived from shared votes.
- PUT/DELETE share a per-session 30/minute default limit. Allowed writes commit with an audit in the same transaction; invalid, rate-limited, and oversized authenticated writes create denied audits without storing label contents.
