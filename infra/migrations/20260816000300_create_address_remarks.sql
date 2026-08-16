-- migrate:up

CREATE TABLE address_remarks (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chain_id bigint NOT NULL CHECK (chain_id = 56),
  canonical_address text NOT NULL,
  label text NOT NULL,
  watched boolean NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT address_remarks_user_chain_address_key
    UNIQUE (user_id, chain_id, canonical_address),
  CONSTRAINT address_remarks_canonical_address_valid
    CHECK (canonical_address ~ '^0x[0-9a-f]{40}$'),
  CONSTRAINT address_remarks_label_valid
    CHECK (
      label = btrim(label)
      AND char_length(label) <= 32
      AND label !~ '[[:cntrl:]]'
    ),
  CONSTRAINT address_remarks_meaningful
    CHECK (label <> '' OR watched),
  CHECK (updated_at >= created_at)
);

CREATE INDEX address_remarks_user_chain_idx
  ON address_remarks (user_id, chain_id, canonical_address);
CREATE INDEX address_remarks_shared_vote_idx
  ON address_remarks (chain_id, canonical_address, label)
  WHERE label <> '';

CREATE TABLE address_remark_audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_user_id uuid,
  session_id uuid,
  chain_id bigint NOT NULL CHECK (chain_id = 56),
  canonical_address text,
  action text NOT NULL CHECK (action IN ('address-remark.put', 'address-remark.delete')),
  outcome text NOT NULL CHECK (outcome IN ('allowed', 'denied')),
  result_code text NOT NULL CHECK (result_code <> ''),
  request_id text NOT NULL CHECK (request_id <> ''),
  created_at timestamptz NOT NULL,
  CHECK (
    canonical_address IS NULL
    OR canonical_address ~ '^0x[0-9a-f]{40}$'
  )
);

CREATE INDEX address_remark_audit_actor_created_idx
  ON address_remark_audit_events (actor_user_id, created_at DESC)
  WHERE actor_user_id IS NOT NULL;
CREATE INDEX address_remark_audit_created_idx
  ON address_remark_audit_events (created_at DESC);

CREATE TRIGGER address_remark_audit_append_only
BEFORE UPDATE OR DELETE ON address_remark_audit_events
FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();

COMMENT ON TABLE address_remarks IS
  'User-owned BSC address labels and watch state; labels also contribute anonymous shared votes.';
COMMENT ON TABLE address_remark_audit_events IS
  'Append-only address remark write decisions without labels, credentials, headers, or user profile data.';

-- migrate:down

DROP TRIGGER address_remark_audit_append_only ON address_remark_audit_events;
DROP TABLE address_remark_audit_events;
DROP TABLE address_remarks;
