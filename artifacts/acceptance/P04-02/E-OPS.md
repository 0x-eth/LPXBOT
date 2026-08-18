# P04-02 Operations Evidence

`apps/signer` now has an executable production runner and remains a separate workspace process. Production configuration requires:

- loopback host and explicit port;
- a bounded bearer token;
- explicit signer identity;
- dedicated PostgreSQL ciphertext-store URL;
- HTTPS KMS URL, signer KMS identity token, KEK ID, and KEK version.

Startup order is configuration, KMS key/version probe, custody table probe, signer/store construction, then listener bind. Missing configuration, KMS, KEK version, or ciphertext store fails closed before serving. HTTP timeouts are bounded, responses are `no-store`, import concurrency is serialized per user, and rejected concurrent requests cannot release another request's ownership.

The API uses a separate metadata-only directory and a loopback remote signer client. Import transport performs one attempt and is never placed on a replayable queue. Graceful SIGINT/SIGTERM shutdown stops the HTTP server and closes the dedicated signer pool.

GitHub Actions run [32089913070](https://github.com/0x-eth/LPXBOT/actions/runs/32089913070) succeeded for commit `2d8f0c84bc2151e97d8f8cbcfaca11808291fc14`: Quality, Governance, Browser, Contracts, Infrastructure, and Security all completed successfully.

This local slice is not custody-ready. Independent signer security review, locked-memory/core-dump evidence, production IAM/grants, KMS backup/rotation/disaster-recovery drill, staging monitoring, and deployment rollback evidence remain unresolved.
