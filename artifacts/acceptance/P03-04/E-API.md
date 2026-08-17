# P03-04 API Evidence

- `GET /api/notifications/history` requires the authenticated current user and accepts only `cursor`, `limit`, `monitorId`, `deliveryStatus`, `from`, and `to`.
- `limit` is constrained to 1 through 100. Malformed cursors, UUIDs, statuses, timestamps, unknown fields, and inverted time ranges fail with `INVALID_NOTIFICATION_HISTORY_QUERY`.
- Pagination is stable on `(createdAt DESC, deliveryId DESC)`. The opaque cursor contains exactly the last row's normalized tuple, and the store reads one extra row to determine `nextCursor`.
- Filters compose over monitor ID, public delivery status, and inclusive creation-time bounds. The store always adds `user_id = currentUserId` before optional filters.
- Public statuses are exactly `pending`, `sending`, `retrying`, `delivered`, and `failed`.
- The response whitelist contains delivery context, destination snapshot, public status, attempts, retry/delivery times, and stable error code. It excludes `userId`, `secretRef`, request bodies, query values, response bodies, provider acknowledgement, and sensitive error details.

Focused API/client coverage passed as part of 11 P03 fixture files / 83 tests. PostgreSQL query and retention behavior passed in 18 files / 83 integration tests.
