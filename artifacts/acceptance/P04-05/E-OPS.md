# P04-05 Operations Evidence

The server read path requires an operator-injected `ControlledWalletReadProviderRegistry`; there is no fallback to a browser URL or arbitrary request-supplied provider. Missing providers fail as `CHAIN_READ_UNAVAILABLE`; incomplete, disabled, or mismatched chains fail as `CHAIN_NOT_ALLOWED`. This keeps production provider selection inside the existing chain registry and access-policy boundary.

Price freshness is explicit. Missing or invalid price data produces `missing`; data beyond the configured age produces `stale`; both return null USD value. Operators can distinguish unavailable price data from a zero balance without parsing logs or provider bodies.

Browser RPC has bounded timeout, body, rate, concurrency, request size, call target, and log range. Redirects, subscriptions, and batches are disabled. Clearing or leaving the page drops the in-memory configured client. The Service Worker has no route, cache, sync task, or message carrying the URL or provider response.

Migration verification uses an isolated database and includes up/down/up. PostgreSQL stores enforce canonical and ownership constraints independently of API validation. Address-book audit events are append-only.

Production controlled-provider deployment, live price-source SLOs, external provider monitoring, and staging rollback drills remain unresolved. This work item is accepted-with-gaps, not parity-verified, not released, and not custody-ready.

Execution counters for this work item: private-key decryptions 0; signing 0; raw transactions 0; broadcasts 0; public RPC calls 0.
