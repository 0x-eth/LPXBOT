# E-SEC

- Contract, API, PostgreSQL, and browser parsers independently validate chain, protocol, V3/V4 identity length, canonical pool keys, operation/user UUIDs, fee pips, transaction hashes, outcomes, completion time, schema version, and exact response fields.
- Same-operation payload conflicts retain only hashes and mismatched field names. Database errors, user profiles, session tokens, roles, tiers, Telegram init data, and arbitrary response fields are not copied into public errors or conflict evidence.
- API responses are `no-store`, bounded, rate limited, and fixed-envelope. Administrator denials occur before attribution reads; audit digests do not retain raw pool identities.
- React renders validated text only. External transaction links use fixed BscScan origins with `rel=noreferrer`; avatar metadata is not fetched by the provenance UI.
- The implementation never visits external RPC, queries `tx.from`, fetches metadata, signs, broadcasts, or performs a funds operation.
- The delivered surface contains an internal recorder and read-only APIs only. It does not implement a public pool creation command.
- Full-history Gitleaks and dependency-audit outcomes are recorded in `command-output.md`.
