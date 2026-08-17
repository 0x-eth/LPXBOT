# P03-02 API Evidence

- `GET/POST /api/monitors`, `GET/PATCH/DELETE /api/monitors/:monitorId`, and explicit enable/disable commands implement the frozen P03-01 routes with authenticated, `Cache-Control: no-store` responses.
- New monitors are disabled at revision 1. `poolKey` accepts only canonical BSC identities and cannot be patched.
- PATCH, lifecycle, and delete commands require `expectedRevision`; effective mutations increment once, no-ops retain the revision, and conflicts return the authoritative monitor.
- Create idempotency is scoped by user. Equal key/payload replays the original object before mutable pool eligibility is rechecked; a changed payload returns `IDEMPOTENCY_CONFLICT`.
- All cross-user GET/PATCH/enable/disable/delete attempts return `MONITOR_NOT_FOUND` without owner data.
- List responses preserve global `enabledCount/totalCount` across filtered pages. The UI count is an aggregate, not a quota.
- Unsupported active TVL and Fee/aTVL conditions return `UNSUPPORTED_METRIC`; non-BSC, oversized, malformed, unsafe transaction-count, and unknown-field requests fail with stable codes.

Focused result: monitor contract, API, and strict browser-client tests passed in the 41-test focused run.
