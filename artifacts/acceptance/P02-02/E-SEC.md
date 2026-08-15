# E-SEC: Offline and fail-closed boundary

Evidence level: `local-fixture-verified` only.

P02-02 performs local PostgreSQL R1 writes only. Chain and target surfaces remain offline/read-only: no external RPC, target endpoint, production secret, signature, transaction broadcast, or funds action is used.

Security boundaries verified in code and tests:

- fixture decoding lives in `apps/indexer/src/testing.ts` and is absent from the package main export;
- production configuration recursively rejects `decoderFixtureId`;
- production ABI, topic, protocol address, and BSC chain selection fail closed when missing;
- only chain ID 56 and contracted windows reach the market provider;
- API routes authenticate before snapshot or stream access;
- market values remain decimal strings and are not coerced through JavaScript `number`;
- conflict payloads are isolated in integrity quarantine rather than applied;
- logs and cursors contain no credentials.

Final Gitleaks and dependency-audit results are recorded in [command-output.md](command-output.md). All P02-01 event, finality, block-timestamp, formula, and target-source gaps remain unresolved.
