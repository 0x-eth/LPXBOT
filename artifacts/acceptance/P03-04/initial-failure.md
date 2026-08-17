# P03-04 Initial Failure Record

Tests were introduced before implementation and exposed these missing boundaries:

- the market worker had durable Outbox rows but no independent process that could claim, deliver, retry, reject late results, or stop gracefully;
- no permit-before-claim hierarchy or lease-budget enforcement existed;
- secret storage had no exact owner/purpose/reference read operation and production startup did not require provider dependencies;
- the frozen SSRF fixture had no production Webhook resolver/transport policy, IP pinning, redirect matrix, timeout budget, or response classifier;
- Telegram had no ownership-aware delivery adapter, HTML/code-point boundary, or provider classifier;
- Outbox transitions had no independent user delivery-history projection and deletion could remove operational source rows;
- no current-user paginated history endpoint or strict history client existed; and
- `/monitors` had no history states, filters, responsive presentation, detail focus flow, or accessibility assertions.

The red tests covered pure adapter, Dispatcher, API, PostgreSQL, migration, and Playwright boundaries. All external dependencies were represented by injected local fixtures from the first failing run onward.
