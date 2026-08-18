# E-REC

Lifecycle coverage proves:

- save activates version 1 only after read-only permission validation;
- failed save destroys the staged wrapped DEK and leaves no configured head;
- failed replacement preserves the old active version;
- successful replacement switches atomically and cryptographically disables the old version;
- delete first enters `deleting`, invalidates capabilities, clears the wrapped DEK, and retains a non-secret tombstone;
- repeated delete on an unconfigured head is idempotent;
- an in-flight test cannot overwrite a replacement, deletion, revocation, or concurrent status transition;
- 90-day expiry and explicit revocation stop credential use;
- connector restart clears abandoned staged save/replacement versions, completes interrupted deletion, and converts abandoned `testing` to `unknown` while advancing the capability epoch.

PostgreSQL concurrency permits only one successful replacement from a shared expected version and preserves exactly one active row. Recovery tests construct interrupted replacement, testing, and deletion states across new repository/service instances. The retained old version remains usable after staged replacement cleanup, and its recovery audit records the cleaned version with the actual retained state.

Connector, KMS fixture, and database restart paths use no provider network. Real OKX requests: 0.
