# P04-03 Operations Evidence

The signer readiness probe now requires the custody wallet, envelope, user Keystore, Keystore-version, failure, and reset-preview schema before binding its loopback listener. API-to-signer requests use an explicit bearer token, bounded body and request timeouts, no-store responses, and one-attempt secret transport.

Normal shutdown runs Keystore capability revocation and KEK zeroization before closing HTTP connections and ending the dedicated PostgreSQL pool. A new signer instance has no unlock sessions and restores all password-mode wallets as locked. Server-KEK readiness and recovery remain independent of user-password state.

Local acceptance uses Node 26.5.0, pnpm 11.17.0, PostgreSQL 17.10 client tooling, Playwright 1.62.1, local Chromium, local PostgreSQL, local KMS fixtures, and injected dependency inventories. Hosted CI uses the repository-pinned Node 22.23.1 and Playwright 1.62.1 environments.

Signing operations: 0. Raw transaction operations: 0. Broadcast calls: 0. External RPC calls: 0.

This work item remains `accepted-with-gaps` and is not custody-ready. Independent signer security review, locked-memory/core-dump enforcement, production KMS IAM/backup/disaster-recovery drills, staging monitoring, live custody exercises, and deployment rollback evidence remain unresolved. It is not parity-verified and not released.
