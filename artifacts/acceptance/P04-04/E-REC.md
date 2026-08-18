# P04-04 Recovery Evidence

Wallet lifecycle coverage verifies:

- rename boundaries, no-op revision stability, stale revision conflicts, and cross-user isolation;
- 300-second preview expiry, token tamper, one-time consumption, dependency changes, asset-risk digest changes, and incomplete inventory;
- normal-delete blocking for tasks, policies, positions, or nonzero assets;
- force confirmation and complete dependency-list matching;
- task-coordinator absence/failure fail-closed behavior and task restoration after store failure;
- concurrent delete serialization with one winner;
- transaction rollback of metadata, preview, Envelopes, tombstone, and audit rows;
- revocation of wallet signer capability and user-password unlock sessions with retained buffer zeroization;
- destruction of current and historical recoverable Envelopes while retaining only non-secret evidence; and
- re-import of the same address after destruction without making an old Envelope recoverable.

Security-password coverage verifies first creation, change, wrong old password, optimistic version conflict, tenant isolation, persistent failure counts, lockout, independent KDF domain/salt/verifier/session state, and internal signer verification. The same password text used for Keystore and security password still produces independent salts, derived material, verifiers, versions, audits, and sessions.

The focused P04-04 plus P04-02/P04-03 signer, AES-GCM tamper, password, lockout, reset, and migration regression passed 19 files / 93 tests. PostgreSQL recovery passed 22 files / 95 tests. No test signs or serializes a transaction, broadcasts, or reaches an external RPC.
