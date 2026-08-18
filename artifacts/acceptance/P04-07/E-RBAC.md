# E-RBAC

The API derives `userId` and actor from the current server session; caller-supplied ownership is never accepted. Every mutation verifies fresh reauthentication before invoking the connector. Cross-user API and repository tests prove owner isolation.

`apps/okx-connector` is a separate application and the only package that owns credential parsing, KMS unwrap, envelope decryption, and fixed OKX egress. API, web, worker, dispatcher, and signer manifests do not depend on it. The API communicates through a loopback-only, bearer-authenticated remote client whose base URL rejects non-loopback authority, TLS substitution, credentials, query/hash data, and path prefixes.

PostgreSQL revokes PUBLIC access to all OKX tables and grants ciphertext access only to the dedicated `lpbot_okx_connector` role. The KMS client requires its dedicated key/version and identity token. Provider permission handling exposes only `read`, `trade`, `withdraw`, and IP-allowlist policy booleans inside the connector; no IP value crosses the boundary.

Real OKX requests: 0. Production KMS/IAM and an independent security review remain unresolved.
