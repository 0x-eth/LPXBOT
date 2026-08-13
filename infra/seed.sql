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

COMMIT;
