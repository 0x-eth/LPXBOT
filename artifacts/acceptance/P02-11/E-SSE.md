# E-SSE

- Authenticated market and recommendation streams obtain the current user blocklist before subscription and construct the same shared eligibility policy used by snapshot reads.
- Market resume cursors use `market-filter:v2`; recommendation resume cursors use `rec-pools:v2`. Both bind the source cursor to the authoritative `blocklistHash` and current filter parameters.
- A cursor with a different blocklist hash is rejected as non-resumable, causing a fresh filtered snapshot rather than replay under stale eligibility.
- Market snapshots, market diff upserts, and recommendation selection are filtered before delivery. Recommendation selection filters and deduplicates before applying its limit.
- On the client, blocklist readiness gates initial pool and recommendation subscriptions. An authoritative hash change replaces the providers, closes old connections, and starts from a snapshot.
- Request generations, cursor validation, and final display projection prevent old connections, late success responses, or late recommendation events from restoring a blocked pool.
- Blocking an expanded pool removes it from the eligible row set, unmounts its detail, and aborts the active Candle/Tick request.
