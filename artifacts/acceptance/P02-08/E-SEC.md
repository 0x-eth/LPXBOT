# E-SEC

- Rule values are loaded from one committed JSON contract; the UI and SQL contain no threshold copies.
- Strict client validation bounds scores, identifiers, timestamps, versions, reason operators, and Decimal strings before rendering. React renders labels and reasons as text rather than HTML.
- PostgreSQL writes use positional parameters and constrained version columns. Label computation remains inside the authenticated read-model pipeline and exposes no mutation route.
- The change adds no RPC access, crawler, metadata or USD-price source, signer, transaction builder, broadcast, funds action, business action, blocking, creator attribution, candle, tick, STATS-01, or STATS-02 implementation.
- `GAP-LABEL-ALGORITHM` remains unresolved. The local rule set is marked `locally-defined` and `not-parity-verified` in the frozen contract.
- Gitleaks 8.30.1 scanned the full 600-commit history and 20.43 MB with no leaks. `pnpm audit:dependencies` reported no known vulnerabilities.
- GitHub Actions security evidence is recorded separately after the final Security job executes its real checkout, scan, install, and audit steps.
