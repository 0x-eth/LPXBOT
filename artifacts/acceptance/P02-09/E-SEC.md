# E-SEC

- Query keys, chain, limit, cursor structure, event names, exact event keys, row keys, protocols, addresses, pool IDs, symbols, fee pips, and positive Decimal Fees are allowlisted or strictly parsed.
- A configured provider failure is converted to a safe 503 envelope before stream headers. The source error string is absent from the response.
- Slow-client protection and the existing read-only rate limiter remain on the shared stats stream boundary.
- Selection uses Decimal arithmetic and a deterministic byte-order tie breaker. It does not use binary floating point for money ordering or aggregation.
- React renders pair and fee values as text. No untrusted HTML, metadata request, external RPC, signer, transaction builder, broadcast, funds action, business action, blocking, creator attribution, candle, or tick source is introduced.
- Gitleaks 8.30.1 scanned 634 commits and approximately 20.54 MB of full history with no leaks. `pnpm audit:dependencies` reported no known vulnerabilities under Node 22.
