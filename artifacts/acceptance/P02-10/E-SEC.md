# E-SEC

- Endpoint query keys and values are allowlisted. Addresses, pool IDs, canonical pool keys, DEX values, bars, chain identity, integral limits/ranges/spacings, and paired decimals are strictly parsed before provider access.
- Provider failures are converted to fixed safe envelopes. Database messages and internal exception text are not returned. Unknown pool, ambiguity, spacing mismatch, invalid request, and service-unavailable cases remain distinct.
- BigInt parsing rejects non-integer event values. Decimal arithmetic rejects non-finite data, uses precision 96, and serializes exact base-10 strings instead of binary floating-point market values.
- React and `lightweight-charts` receive parsed data values; no untrusted HTML is rendered. The client rejects unknown response keys, invalid Decimal strings, duplicate/descending Candle timestamps, and malformed null combinations.
- The implementation performs no external RPC, metadata fetch, price fetch, production sample fetch, signer call, transaction construction, broadcast, or funds operation.
- Gitleaks 8.30.1 scanned 675 commits and approximately 20.80 MB of full history with no leaks. `pnpm audit:dependencies` reported no known vulnerabilities; exact local gate results are recorded in `command-output.md`.
