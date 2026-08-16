# E-API

- `packages/api-contract` freezes `AddressRemark`, `SharedRemark`, list/put/delete response types, `PutAddressRemarkRequest`, and the three authenticated endpoint paths.
- `GET /api/address-remarks` returns the session user's personal rows plus one shared winning label per address. Shared rows contain only address, label, and vote count; no contributor identity is returned.
- `PUT /api/address-remarks` accepts exactly `address`, `label`, and `watched`. The address is canonicalized, the label is trimmed, control characters are rejected, and the post-trim Unicode limit is 32 code points.
- `DELETE /api/address-remarks/:address` is idempotent and reports whether a personal row existed. All SQL ownership predicates derive `user_id` from the authenticated session, never from request data.
- An empty label with `watched: true` persists a watch-only row. Empty label plus `watched: false` removes the row.
- Oversized PUT bodies return `413 REQUEST_TOO_LARGE` and record a body-free denied audit. Store failures return the existing generic error envelope without exposing SQL or upstream detail.
- The focused contract/API/client run passed 37 tests across six files. Real PostgreSQL CRUD, voting, user isolation, unique constraints, and append-only audit behavior passed in the 39-test PostgreSQL suite.

`/api/address-book` and `securityPassword` are outside this work item. Extra fields, including `securityPassword`, are rejected.
