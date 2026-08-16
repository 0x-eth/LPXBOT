# E-RBAC

- P02-07 adds no mutation endpoint and does not change pool-read authorization. Existing authenticated market snapshot, SSE, and preference boundaries remain in force.
- Cross-device writes are limited to the existing user preference allowlist and optimistic revision contract. Ownership continues to come exclusively from the authenticated session user ID.
- Comparison selection is React session state only. It is absent from `UserPreferences`, request payloads, PostgreSQL rows, local storage, and broadcast messages.
- URL filters contain only public pool discovery criteria. They cannot select an owner, role, account, preference revision, or write target.
- PostgreSQL coverage confirms preference isolation between users and consistent schema v4 recovery for two sessions belonging to the same user.
