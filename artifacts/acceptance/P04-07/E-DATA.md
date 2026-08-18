# E-DATA

Migration `20260819000100_create_okx_credentials.sql` creates connector-owned heads, versions, tombstones, and append-only audit events. A partial unique index permits one active version per user. The ordinary `user_preferences` table has no OKX credential, fragment, hash, fingerprint, ciphertext, or credential identifier column.

Each staged version receives an independent random 256-bit DEK and 96-bit nonce. AES-256-GCM authenticates fixed AAD containing domain, user ID, credential ID, version, and environment. PostgreSQL stores ciphertext, nonce, authentication tag, wrapped DEK, KMS key identifiers, version, and non-secret lifecycle state. Cryptographic deletion sets the wrapped DEK to NULL before retaining a non-secret tombstone.

Ciphertext, AAD identity, and version tamper tests fail closed. Cross-user reads return no envelope. Missing KMS availability or decrypt grant returns a closed connector error. The PostgreSQL suite completed every migration up, every down in reverse order, and every up again; 25 files passed, 1 fixture was explicitly skipped, 104 tests passed, and 1 was skipped.

All stored fixture credentials are synthetic. Real OKX requests: 0.
