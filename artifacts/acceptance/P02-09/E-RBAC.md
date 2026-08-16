# E-RBAC

- The stream remains authenticated by the existing browser session. Credentials are sent as cookies and never embedded in the recommendation cursor or query URL.
- A non-admin request carrying `user_id` receives 403 before either stats or recommendation providers are read.
- An admin `user_id` filter is passed only to the stats provider. `MarketPoolsProvider.getTopFees` receives no user identity, so the recommendation collection cannot fork by account.
- Chain and limit are public read filters bound into the cursor. Reusing a cursor with a different limit fails validation.
- Recommendation links target the existing read-only pool discovery route. Playwright records no non-GET task request during keyboard navigation.
- P02-09 introduces no ownership-changing, management, preference, task, signer, or funds endpoint.
