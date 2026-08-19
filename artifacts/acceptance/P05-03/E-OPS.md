# E-OPS

Production quote configuration is intentionally absent. `createSwapQuoteProviderFromEnv` returns no provider when unconfigured, deterministic fixtures are test-only, and `/api/swap/quote` returns a stable 503 when no controlled application is injected. Enabling a future production source requires a new bounded provider implementation and explicit runtime composition; P05-03 does not silently fall back to OKX credentials or a public RPC.

Pricing recovery is PostgreSQL-backed. Import, observation, state event/tombstone, stream sequence, and Outbox publication share one transaction. API process restart reconstructs the ledger and resumes SSE from durable rows. Operations can monitor Outbox age and stream cursor failures without a chain writer.

Migration rollback order removes Outbox, stream heads, tombstones, state events, observations, positions, and quote snapshots before the shared constraint/function. The global PostgreSQL cycle validates up/down/up on a fresh connection. Application rollback requires stopping P05-03 readers, applying the migration down section, restoring the prior build, and verifying the P05-02 read surfaces. No chain rollback exists because the feature performs no chain write.

The work item remains `accepted-with-gaps`. Production API runner/provider composition, live Registry code-hash validation, monitoring/SLO, retention operations, and staging rollback rehearsal remain unresolved. It is not parity-verified and not released.

Operational counters: signing 0; broadcast 0; chain writes 0; real-fund operations 0; production calldata generation 0.
