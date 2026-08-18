# P04-02 Recovery Evidence

The restart fixture imports a synthetic secp256k1 key, commits its authenticated envelope, constructs a new signer instance with the same local versioned KMS fixture and store, opens the current version, re-derives the address, and returns the same checksummed address.

Recovery fails closed in each tested condition:

- unavailable KMS: wallet becomes `locked`;
- unavailable or wrong KEK version: wallet remains `locked`;
- missing current envelope: wallet becomes `quarantined`;
- AAD, ciphertext, tag, nonce, or derived-address mismatch: wallet becomes `quarantined`; and
- no older envelope or fallback plaintext path is attempted.

The P04-01 AES-256-GCM known answer and exact LF-separated AAD fixture were replayed byte-for-byte. Its AAD, ciphertext, tag, and nonce tamper cases all failed authentication.

Runtime readiness probes KMS key identity/version and all three signer-owned custody tables before binding the loopback listener. Startup failure closes the dedicated pool and opens no HTTP port. Normal close stops connections and releases that pool.

No recovery test signs a digest or transaction, broadcasts, or accesses an external RPC.
