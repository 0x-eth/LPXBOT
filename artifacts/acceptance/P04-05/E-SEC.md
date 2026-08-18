# P04-05 Security Evidence

The browser custom RPC boundary conforms to the frozen `settings-contracts.json.customRpc` policy:

- Browser runtime only; non-browser construction requires an explicitly injected fixture fetcher.
- HTTPS only, except loopback HTTP in an explicit development build.
- Opaque-origin sandboxed `about:srcdoc` iframe with `sandbox="allow-scripts"` and no `allow-same-origin`.
- `credentials: omit`, `cache: no-store`, `redirect: error`, CORS mode, and no referrer.
- Default-deny method policy. The allowlist contains only read/simulation methods; account, permission, signing, transaction, wallet mutation, debug, trace, subscription, batch, and unknown methods are rejected locally.
- `eth_call`/`eth_estimateGas` require a bounded target/data shape. `eth_getLogs` is bounded to 5,000 blocks or one block hash.
- Fixed limits: 8-second total timeout, 1 MiB streamed response cap, 5 requests/second, and 2 concurrent requests.
- Strict single JSON-RPC response validation binds version and request ID, rejects arrays/batches, malformed UTF-8, oversized bodies, redirects, and provider error details.
- The raw URL exists only in React/session memory and the short-lived iframe message. It is not persisted and does not enter API, server database, queue, telemetry, logs, Service Worker, background sync, screenshots, or rendered HTML after blur.

Address-book password ingress uses the dedicated P04-04 signer verifier and clears buffers/state. Audit records exclude password, labels, notes, request headers, and provider payloads. Server balances cannot read or receive the browser custom URL.

Focused browser-RPC and API security tests passed. Full-history Gitleaks and dependency audit results are recorded in `command-output.md` after the final gate run.

Private-key decryptions: 0. Signing operations: 0. Raw transaction operations: 0. Broadcast calls: 0. Public RPC calls: 0.
