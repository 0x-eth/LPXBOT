# E-SEC

- Labels are normalized at the API boundary and constrained again in PostgreSQL. Control characters, noncanonical stored addresses, padded stored labels, overlength labels, and meaningless rows are rejected.
- React renders personal and shared labels as text nodes. The browser test uses `<b>共享鲸鱼</b>` and verifies that the literal text appears while no `b` element is created.
- SQL uses positional parameters. Shared aggregation exposes no contributor identity. Audit rows intentionally omit labels, request bodies, credentials, headers, and user profile data and are protected by an append-only trigger.
- The 2 KiB PUT body limit, exact request-field allowlist, credentialed fetches, response-field parsers, per-session write rate limit, no-store caching, and generic error envelopes are covered by focused tests.
- P02-05 adds no signer, RPC write, transaction builder, broadcast path, price source, funds action, `/api/address-book`, or `securityPassword` handling.
- Full-history Gitleaks and `pnpm audit:dependencies` are final gates. No external RPC or production secret is used by P02-05 verification.
