# P03-04 Operations Evidence

- `apps/dispatcher` is a separate workspace process boundary; the market worker only creates durable Outbox work and performs no provider I/O.
- The Dispatcher peeks due work, acquires global/channel/destination permits, and only then calls `claimDue`. A rejected permit does not claim a row or increase its attempt count.
- Batch size is configurable and capped at 100. Shutdown stops new claims and waits for in-flight delivery work. Each delivery uses the remaining Outbox lease as an abort budget, and stale completion is rejected by lease-token compare-and-set.
- Expired leases recover through the existing Outbox replacement path after restart. Retry, dead, delivered, and recovered transitions remain atomic with delivery history.
- Production construction fails closed without PostgreSQL, a real secret-store boundary, Webhook transport, or Telegram transport. Resolver and transports remain injectable for deterministic local acceptance.
- DNS, connect/TLS, first-byte, and total request budgets are 2s, 3s, 5s, and 10s respectively; responses are capped at 64 KiB.
- Notification history has no automatic cleanup in this phase. A production retention policy remains an unresolved operations decision.

Local infrastructure health, repeatable migration/seed checks, PostgreSQL integration, full-history Gitleaks, and dependency audit passed. Hosted CI is recorded after the acceptance snapshot is pushed.
