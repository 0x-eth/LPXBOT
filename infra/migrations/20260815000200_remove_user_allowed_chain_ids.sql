-- migrate:up
ALTER TABLE users DROP COLUMN allowed_chain_ids;

COMMENT ON TABLE users IS
  'Account identity and role state; effective chain access is derived from chain_access_policies.';

-- migrate:down
ALTER TABLE users ADD COLUMN allowed_chain_ids integer[] NOT NULL DEFAULT '{}';
COMMENT ON TABLE users IS NULL;
