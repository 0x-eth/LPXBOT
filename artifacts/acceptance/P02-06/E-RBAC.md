# E-RBAC

- `/api/pools/by-token/:address` resolves the existing session before parsing or querying. Anonymous and expired sessions receive the standard authentication envelope.
- The route applies `roleCanAccess(..., "authenticated")`; account status, maintenance, region, and role policy remain enforced by the shared authentication boundary.
- The read limiter keys authenticated requests by the opaque session token and otherwise by IP. Search input contains no user ID and cannot select another user's data.
- Preferences ownership is derived exclusively from `session.userId`. The PATCH body accepts only `expectedRevision` and a whitelisted `changes` object; it cannot carry an owner or revision override.
- PostgreSQL stores one preference row per user. Tests cover two-user isolation, two sessions for one user, stale-device conflict, and consistent restoration after relogin.
- Pool catalog and market snapshot queries are read-only user surfaces. No catalog, event, snapshot, cursor, or outbox mutation route is exposed.
