# P03-02 Data Evidence

Migration `20260817000500_create_monitoring_outbox.sql` creates user-owned monitors, create-idempotency records, logical candidates, evaluation watermarks, credential-free notification Outbox rows, and terminal-replacement suppressions.

The schema constrains canonical BSC pool keys, revisions, lifecycle state, 0..16 conditions, enabled-condition counts, candidate and dedupe SHA-256 keys, destination revisions, lease tokens, attempt counts, retry times, terminal timestamps, ownership foreign keys, and query/claim indexes.

The pure evaluator supports Volume, Fees, Fee/TVL, TVL, transaction count, and metric version. It uses base-10 integer arithmetic for gte/lte, binds the configured window to canonical `windowStart/windowEnd`, accepts the exact 120-second freshness boundary, and fails closed for invalid/future timestamps, stale/not-ready/partial input, missing/null/non-finite metrics, version mismatch, unresolved metrics, and unknown Han/Hook classification.

The worker reads the current P02-11 user blocklist, binds `blocklistHash`, copies the authoritative `sourceGenerationId`, and accepts only inputs marked `canonical-market-projection`.

dbmate applied the migration once and then performed an immediate no-op repeat. The complete temporary-database migration integration applied all ups, all downs in reverse, reconnected, and applied all ups again.
