# E-OPS

The connector has its own production runner, loopback HTTP listener, ciphertext database URL, identity, dedicated KMS configuration, and default-denied egress flag. Startup runs staged/testing/deleting/rotation recovery before listening. SIGINT/SIGTERM stop the listener and close the database pool.

Configuration rejects non-production mode, non-loopback binding, non-PostgreSQL storage, non-TLS KMS, invalid ports, and missing identity/token/key inputs. API processes only receive the loopback connector token and endpoint; ordinary applications receive no KMS identity or ciphertext role. Rollback is the migration down path after connector traffic is stopped; up/down/up was exercised locally.

The local acceptance environment used synthetic credentials, an in-process KMS fixture, local PostgreSQL, browser route fixtures, and injected DNS/request transports. Production egress was never enabled. Real OKX requests: 0.

Status remains `accepted-with-gaps`. `GAP-P04-OKX-LIVE`, production KMS/IAM provisioning, independent security review, real read-only sandbox validation, production monitoring/SLO, and staged rollback drills remain unresolved.
