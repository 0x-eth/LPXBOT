# E-API

- `GET /api/pools/create-history?limit=&cursor=` authenticates first, binds the query to the current session user, validates an opaque cursor and a 1-100 limit, and returns `Cache-Control: no-store`.
- `GET /api/admin/pool-creators?address=&chainId=56` is the V3 compatibility query. Mixed-case addresses are canonicalized; wrong chains, unknown fields, duplicate values, fuzzy identities, and malformed addresses are rejected.
- `POST /api/admin/pool-creators` accepts exactly one of `addresses` or canonical `poolKeys`, preserves one result for every requested identity, and limits a batch to 100 unique identities. V3 and V4 pool keys are supported without mixing identity forms.
- Missing provenance is a successful `creator: null`; it is never converted into a guessed user. History uses an empty `items` array for the same absence case.
- All three reads are rate limited and return fixed error envelopes. The batch body is limited to 32 KiB; an oversized body returns no-store 413 `REQUEST_TOO_LARGE` without parsing or retaining its identities.
- No HTTP provenance write endpoint is registered. The only write contract is the internal `PoolCreationProvenanceRecorder` port.

