# E-SEC

- Token input must be one legal 20-byte EVM address and is canonicalized before comparison. Pool-mode values accept exactly a 20-byte V3 address or 32-byte V4 pool ID; all comparisons use lowercase canonical values.
- Query keys are allowlisted. Chain support is exactly `bsc`/56, protocol values use the frozen DEX allowlist, limit is bounded to 1..100, and sort is bounded to fees/volume.
- SQL uses positional parameters, including protocol arrays and bounded limits. The API returns catalog/snapshot contract fields only and uses the generic error handler for unexpected provider/storage failures.
- React renders symbols and identities as text. Missing symbol and numeric data remain null placeholders; no untrusted markup or fetched metadata is introduced.
- Search cancellation combines `AbortController` with a monotonically increasing generation, so both cooperative cancellation and non-cooperative late responses are contained.
- Column preferences are normalized on the server and client. Unknown or duplicate stored columns are discarded, locked columns are reconstructed, and unrelated P01 preferences are preserved.
- P02-06 adds no external RPC, crawler, Token metadata source, price source, creator inference, signer, transaction builder, broadcast, funds action, or production secret use.
- Local Gitleaks 8.30.1 scanned the full 550-commit history (20.20 MB) with no leaks, and `pnpm audit:dependencies` found no known vulnerabilities. GitHub Actions Security job `95159507483` independently passed its incoming-push Gitleaks and dependency-audit steps; the different scan ranges are recorded explicitly in `command-output.md`.
