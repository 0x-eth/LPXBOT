# P04-04 Operations Evidence

Signer readiness now requires the wallet, Envelope, wallet audit, delete-preview, tombstone, Keystore, and security-password current/version/audit schema before binding its loopback listener. The internal security-password verification route uses the existing bearer-authenticated, owner-scoped, bounded signer HTTP boundary.

`startSignerRuntime` accepts authoritative `WalletDependencyInventory` and `WalletTaskCoordinator` ports and passes them into the signer service. The repository does not yet contain production task, policy, position, or asset business tables/adapters; a default production start therefore has no authoritative inventory and delete preview fails closed. Deployments must inject complete authoritative projections and a task coordinator before enabling wallet deletion. This is an explicit `accepted-with-gaps` boundary, not an empty-inventory assumption.

Local acceptance uses Node 26.5.0, pnpm 11.17.0, PostgreSQL 17.10 client tooling, Playwright 1.62.1, local Chromium, local PostgreSQL, local/injected KMS, and injected dependency fixtures. Node emits the repository's expected Node 22 engine warning; hosted CI uses the pinned Node 22 toolchain.

The work item remains `accepted-with-gaps`. Independent signer security review, locked-memory/core-dump enforcement, production inventory/coordinator adapters, production KMS disaster recovery, staging monitoring, and deployment rollback drills remain unresolved. This evidence does not establish custody-ready, parity-verified, or released status.

Private-key decryptions: 0. Signing operations: 0. Raw transaction operations: 0. Broadcast calls: 0. External RPC calls: 0.
