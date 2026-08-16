# E-SEC

- Rule values are loaded from one committed JSON contract; the UI and SQL contain no threshold copies.
- Strict client validation bounds scores, identifiers, timestamps, versions, reason operators, and Decimal strings before rendering. React renders labels and reasons as text rather than HTML.
- PostgreSQL writes use positional parameters and constrained version columns. Label computation remains inside the authenticated read-model pipeline and exposes no mutation route.
- The change adds no RPC access, crawler, metadata or USD-price source, signer, transaction builder, broadcast, funds action, business action, blocking, creator attribution, candle, tick, STATS-01, or STATS-02 implementation.
- `GAP-LABEL-ALGORITHM` remains unresolved. The local rule set is marked `locally-defined` and `not-parity-verified` in the frozen contract.
- Full-history Gitleaks and dependency-audit results are recorded in `command-output.md` after the final security gate.
