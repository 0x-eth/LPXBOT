# P04-06 Security Evidence

The API, worker, Redis queue, and ordinary application database paths have no private-key decryption capability. The signer exposes only plan-bound transfer signing: it has no arbitrary digest or calldata endpoint, binds to loopback, fails closed without explicit identity/KMS/ciphertext readiness, and rejects public signer URLs.

Before signing, the signer-side PostgreSQL authorizer reconstitutes the stored immutable plan and validates tenant/user/wallet ownership, chain ID, nonce and fencing token, recipient, amount, target, value, calldata, deadline, fee cap, policy digest, plan digest, execution mode, and reauthenticated unlock session. The only accepted ERC-20 selector is `transfer(address,uint256)`.

New-address passwords use a dedicated, bounded, no-store media type and the P04-04 internal verifier. Password bytes are cleared by the web client, API handler, service ownership boundary, and signer verifier. Tests assert that passwords are absent from request hashes, idempotency records, operations, outbox payloads, queues, logs, audit, telemetry, rendered HTML, and API responses.

Raw transaction bytes are returned only to the dedicated delivery port, never to API/worker/Redis or public signer responses, and are zeroized after delivery. The local user-password test rejects the wrong unlock session, signs only with the matching session through viem, and verifies that only the delivery port observes the transient raw bytes.

The API local-chain allowlist is explicit and defaults empty. A chain must also pass the current account policy. Every other chain stops at `ready-for-approval`; it is not allocated for signing, signed, or broadcast. All acceptance wallets and keys are synthetic local fixtures.

Full-history Gitleaks 8.30.1 scanned 1,192 commits / 24.23 MB and found no leaks. Its only P04-06 allowance is the exact loopback Anvil integration path plus Anvil's documented account-zero development-key prefix. `pnpm audit:dependencies` reported no known vulnerabilities. Public RPC, testnet, mainnet, and real-fund actions: 0.
