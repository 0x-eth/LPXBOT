BEGIN;

INSERT INTO app_metadata (metadata_key, metadata_value, updated_at)
VALUES (
  'fixture_version',
  'p00-03-v1',
  TIMESTAMPTZ '2026-08-13 00:00:00+00'
)
ON CONFLICT (metadata_key) DO UPDATE
SET
  metadata_value = EXCLUDED.metadata_value,
  updated_at = EXCLUDED.updated_at
WHERE
  app_metadata.metadata_value IS DISTINCT FROM EXCLUDED.metadata_value
  OR app_metadata.updated_at IS DISTINCT FROM EXCLUDED.updated_at;

WITH seeded AS (
  INSERT INTO chain_access_policies (
    chain_id, access, revision, updated_by, updated_at, reason
  ) VALUES
    (
      56,
      'all',
      1,
      'local-fixture-seed',
      TIMESTAMPTZ '2026-08-15 00:00:00+00',
      'Deterministic local fixture seed; not a live-observed value'
    ),
    (
      8453,
      'off',
      1,
      'local-fixture-seed',
      TIMESTAMPTZ '2026-08-15 00:00:00+00',
      'Deterministic local fixture seed; not a live-observed value'
    ),
    (
      1,
      'off',
      1,
      'local-fixture-seed',
      TIMESTAMPTZ '2026-08-15 00:00:00+00',
      'Deterministic local fixture seed; not a live-observed value'
    ),
    (
      4663,
      'off',
      1,
      'local-fixture-seed',
      TIMESTAMPTZ '2026-08-15 00:00:00+00',
      'Deterministic local fixture seed; not a live-observed value'
    ),
    (
      196,
      'off',
      1,
      'local-fixture-seed',
      TIMESTAMPTZ '2026-08-15 00:00:00+00',
      'Deterministic local fixture seed; not a live-observed value'
    )
  ON CONFLICT (chain_id) DO NOTHING
  RETURNING chain_id, access, revision, updated_by, updated_at, reason
)
INSERT INTO chain_access_policy_history (
  chain_id, revision, before_access, after_access, updated_by, updated_at, reason
)
SELECT chain_id, revision, NULL, access, updated_by, updated_at, reason
FROM seeded;

COMMIT;
