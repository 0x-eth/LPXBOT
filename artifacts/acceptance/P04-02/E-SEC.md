# P04-02 Security Evidence

- Private keys are accepted as exact 32-byte secp256k1 scalars in `(0, n)`. Known EIP-55 address answers and CSPRNG rejection sampling are covered.
- Every wallet version uses an independent 32-byte DEK, AES-256-GCM, a 12-byte nonce, a 16-byte tag, and the frozen P04-01 LF AAD. Only the configured versioned KMS can wrap or unwrap a DEK.
- Signer ingress, decoded private-key, generated private-key, DEK, and API transport-copy buffers are cleared on success and failure exits. The public signer capability set is exactly import, generate, seal, and controlled open/verify.
- No arbitrary digest/message/transaction signing, raw transaction, broadcast, queue retry, or RPC capability exists in the signer boundary.
- Tamper authentication failures quarantine the wallet. KMS and KEK availability failures lock it. Neither path falls back to plaintext or an older envelope.
- The owned-source and P04-02/Playwright artifact scan found no synthetic private-key literal. Database rows, API response/log fixtures, screenshots, audit fields, queue schemas, and error DTOs contain no private key.

Gitleaks 8.30.1 scanned the complete 977-commit history and approximately 22.92 MB with no leaks. `pnpm audit:dependencies` reported no known vulnerabilities. Final scans returned zero owned-source private-key literals, zero P04-02/Playwright artifact secret matches, zero sensitive Outbox columns, and zero forbidden signer capability matches. The custody wallet, envelope, and audit tables contained `0|0|0` rows after the PostgreSQL suite.

All KMS, database, and browser dependencies in acceptance were local or injected fixtures. Transaction signatures: 0. Raw transactions: 0. Broadcast calls: 0. External RPC calls: 0.
