# E-SEC

- Filter query keys and option values are allowlisted. Duplicate known keys, malformed ranges, negative bounds, non-finite values, empty version selections, and min-greater-than-max ranges are rejected.
- Numeric logic uses Decimal rather than binary floating point. Null metrics remain null and cannot win a sort or comparison best-value decision.
- Han checks operate on known symbol text only. React renders every symbol and identity as text; no untrusted HTML or external metadata source is introduced.
- Comparison keys must already exist in the bound snapshot, selection is capped at three, and canonical fee tier display accepts unsigned integer `feePips` only.
- P02-07 adds no RPC, crawler, price source, signer, transaction builder, broadcast, funds action, business context action, creator inference, label algorithm, candle, or tick data source.
- Gitleaks 8.30.1 scanned the full 571-commit history and approximately 20.29 MB with no leaks. `pnpm audit:dependencies` reported no known vulnerabilities.
- GitHub Actions run `31949479544`, attempt 2, independently passed Security job `95171738517` with real checkout, Gitleaks action, dependency install, and audit steps. The action's push-range scan is recorded separately from the local full-history scan.
