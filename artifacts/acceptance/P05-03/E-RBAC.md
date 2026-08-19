# E-RBAC

An authenticated session is necessary but not sufficient. Quote resolves `walletId` through the current user directory before any provider call; a wallet owned by another user, an unknown wallet, or a quarantined wallet receives ownership-safe denial.

Pricing import accepts only a P05-02 snapshot whose user, wallet, owner, chain, platform, token ID, PositionManager, code hash, Registry version, and page digest all agree. Quarantined and stale snapshots are never imported. The client cannot submit PositionManager, router, spender, selector, pool path, provider, RPC URL, or target address.

List, import, transition, stream head, and Outbox queries bind `tenantId+userId`. A pricing ID is looked up inside that scope, preventing enumeration across users. SSE cursors carry the same scope under HMAC integrity, and a cross-user cursor is rejected before replay.

Evidence: `tests/p05-swap-quote-api.test.ts`, `tests/p05-pricing-position-api.test.ts`, `tests/p05-pricing-position-ledger.test.ts`, `tests/p05-pricing-position-sse.test.ts`, and `tests/integration/postgres-pricing-position-store.integration.ts`.
