-- migrate:up

ALTER TABLE custody_wallets
  ADD CONSTRAINT custody_wallets_user_wallet_unique UNIQUE (user_id, wallet_id);

CREATE TABLE custody_wallet_custom_tokens (
  user_id uuid NOT NULL,
  wallet_id uuid NOT NULL,
  chain_id bigint NOT NULL CHECK (chain_id > 0),
  token_address text NOT NULL CHECK (token_address ~ '^0x[0-9a-f]{40}$'),
  token_name text NOT NULL CHECK (
    char_length(token_name) BETWEEN 1 AND 128
    AND token_name = btrim(token_name)
    AND token_name !~ '[[:cntrl:]]'
  ),
  token_symbol text NOT NULL CHECK (
    char_length(token_symbol) BETWEEN 1 AND 32
    AND token_symbol = btrim(token_symbol)
    AND token_symbol !~ '[[:cntrl:]]'
  ),
  token_decimals integer NOT NULL CHECK (token_decimals BETWEEN 0 AND 255),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, wallet_id, chain_id, token_address),
  FOREIGN KEY (user_id, wallet_id)
    REFERENCES custody_wallets(user_id, wallet_id)
    ON DELETE CASCADE
);

CREATE INDEX custody_wallet_custom_tokens_wallet_chain_idx
  ON custody_wallet_custom_tokens (user_id, wallet_id, chain_id, created_at, token_address);

CREATE TABLE wallet_address_book_entries (
  entry_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chain_id bigint NOT NULL CHECK (chain_id > 0),
  canonical_address text NOT NULL CHECK (canonical_address ~ '^0x[0-9a-f]{40}$'),
  label text NOT NULL CHECK (
    char_length(label) BETWEEN 1 AND 80
    AND label = btrim(label)
    AND label !~ '[[:cntrl:]]'
  ),
  note text NOT NULL DEFAULT '' CHECK (
    char_length(note) <= 280
    AND note = btrim(note)
    AND note !~ '[[:cntrl:]]'
  ),
  category text NOT NULL CHECK (category IN ('person', 'exchange', 'protocol', 'other')),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (user_id, chain_id, canonical_address),
  UNIQUE (user_id, entry_id),
  CHECK (updated_at >= created_at)
);

CREATE INDEX wallet_address_book_entries_user_chain_idx
  ON wallet_address_book_entries (user_id, chain_id, label COLLATE "C", entry_id);

CREATE TABLE wallet_address_book_audit_events (
  audit_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_user_id uuid,
  session_id uuid,
  entry_id uuid,
  chain_id bigint,
  canonical_address text,
  action text NOT NULL CHECK (action IN ('address-book.create', 'address-book.patch', 'address-book.delete')),
  outcome text NOT NULL CHECK (outcome IN ('allowed', 'denied')),
  result_code text NOT NULL CHECK (result_code <> ''),
  request_id text NOT NULL CHECK (request_id <> ''),
  created_at timestamptz NOT NULL,
  CHECK (chain_id IS NULL OR chain_id > 0),
  CHECK (canonical_address IS NULL OR canonical_address ~ '^0x[0-9a-f]{40}$')
);

CREATE INDEX wallet_address_book_audit_user_created_idx
  ON wallet_address_book_audit_events (actor_user_id, created_at DESC, audit_id DESC)
  WHERE actor_user_id IS NOT NULL;

CREATE FUNCTION reject_wallet_address_book_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'wallet address book audit events are append-only';
END;
$$;

CREATE TRIGGER wallet_address_book_audit_append_only
BEFORE UPDATE OR DELETE ON wallet_address_book_audit_events
FOR EACH ROW EXECUTE FUNCTION reject_wallet_address_book_audit_mutation();

COMMENT ON TABLE custody_wallet_custom_tokens IS
  'Per-wallet ERC-20 metadata accepted only after controlled-provider code and metadata validation.';
COMMENT ON TABLE wallet_address_book_entries IS
  'Independent wallet address-book domain; this table does not reuse or alter address_remarks semantics.';
COMMENT ON TABLE wallet_address_book_audit_events IS
  'Append-only address-book decisions without labels, notes, passwords, headers, or provider payloads.';

REVOKE ALL ON custody_wallet_custom_tokens FROM PUBLIC;
REVOKE ALL ON wallet_address_book_entries FROM PUBLIC;
REVOKE ALL ON wallet_address_book_audit_events FROM PUBLIC;

-- migrate:down

DROP TRIGGER wallet_address_book_audit_append_only ON wallet_address_book_audit_events;
DROP TABLE wallet_address_book_audit_events;
DROP FUNCTION reject_wallet_address_book_audit_mutation();
DROP TABLE wallet_address_book_entries;
DROP TABLE custody_wallet_custom_tokens;
ALTER TABLE custody_wallets DROP CONSTRAINT custody_wallets_user_wallet_unique;
