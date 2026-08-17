# P03-03 Initial Failure Record

Tests added before implementation exposed these missing boundaries:

- notification preference and destination endpoints returned no P03-03 contract;
- destination idempotency, revision conflicts, owner isolation, redaction, and tombstones had no store;
- the frozen P03-01 template and HMAC fixture had no compiler or signer;
- the P03-02 selector accepted no candidate/monitor/category context and selected no configured destinations;
- monitor DTOs and editors had no per-monitor destination binding;
- `/settings` had no category preferences or destination management; and
- local notification testing had no explicit non-persistent sink contract.

Each failure was exercised at a pure-function, API, PostgreSQL, selector, strict-client, or browser boundary before its corresponding implementation was added.
