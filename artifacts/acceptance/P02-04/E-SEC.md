# E-SEC

- The liquidity stream is a GET-only public data endpoint and has no signer, transaction builder, RPC transport, mutation handler, broadcast path, or funds operation.
- Query input is allowlisted and structurally validated before the stream is opened. Pool IDs allow only 20-byte addresses or 32-byte IDs; token/user allow only 20-byte addresses; NFT and `since` allow only safe non-negative decimal integers.
- Public connection rate limiting defaults to 60 requests per minute. Slow clients are drained with bounded buffering and disconnected above 1 MiB; close and error paths abort provider iteration.
- SQL filter inputs use PostgreSQL parameters. Protocol values are closed over the four contracted identifiers in TypeScript and database constraints.
- Full-history Gitleaks and `pnpm audit:dependencies` are final gates. No external RPC, production secret, signing, broadcast, or funds operation is used by P02-04 tests or CI.
