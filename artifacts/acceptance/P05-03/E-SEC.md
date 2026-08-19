# E-SEC

Quote ingress has an exact seven-field allowlist. It rejects raw calldata, router, spender, selector, provider, RPC endpoint, target, and OKX credential fields. The P04-07 user OKX key path is not imported or reused by the quote adapter.

The controlled provider boundary enforces timeout, abort, maximum response bytes, strict snapshot fields, freshness, route endpoints, gas arithmetic, runtime code hash, and Registry identity. Public errors expose stable codes only. `LPXBOT_SWAP_QUOTE v1` binds every public quote field; mutation of any field invalidates the digest.

Quote storage contains no raw calldata, secret, user OKX key, or arbitrary target address. Raw calldata is never generated or returned. The environment provider factory is test-fixture-only, while a production-unconfigured source fails closed. The router selector allowlist remains empty.

Security counters: signing 0; broadcast 0; chain writes 0; real-fund operations 0; production calldata generation 0. Gitleaks scans full git history, and dependency audit reports no known vulnerability.
