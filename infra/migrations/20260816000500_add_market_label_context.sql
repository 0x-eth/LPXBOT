-- migrate:up

ALTER TABLE market_snapshots
  ADD COLUMN canonical_revision text,
  ADD COLUMN metric_version text NOT NULL DEFAULT 'market-metrics/v1',
  ADD COLUMN label_rule_version text NOT NULL DEFAULT 'pool-labels/local-v1';

UPDATE market_snapshots
   SET canonical_revision = 'canonical:v1:' || snapshot_hash
 WHERE canonical_revision IS NULL;

ALTER TABLE market_snapshots
  ALTER COLUMN canonical_revision SET NOT NULL,
  ALTER COLUMN metric_version DROP DEFAULT,
  ALTER COLUMN label_rule_version DROP DEFAULT,
  ADD CONSTRAINT market_snapshots_canonical_revision_format
    CHECK (canonical_revision ~ '^canonical:v1:[0-9a-z-]+$'),
  ADD CONSTRAINT market_snapshots_metric_version_check
    CHECK (metric_version = 'market-metrics/v1'),
  ADD CONSTRAINT market_snapshots_label_rule_version_check
    CHECK (label_rule_version = 'pool-labels/local-v1');

-- migrate:down

ALTER TABLE market_snapshots
  DROP CONSTRAINT IF EXISTS market_snapshots_label_rule_version_check,
  DROP CONSTRAINT IF EXISTS market_snapshots_metric_version_check,
  DROP CONSTRAINT IF EXISTS market_snapshots_canonical_revision_format,
  DROP COLUMN IF EXISTS label_rule_version,
  DROP COLUMN IF EXISTS metric_version,
  DROP COLUMN IF EXISTS canonical_revision;
