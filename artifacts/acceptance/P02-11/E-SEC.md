# E-SEC

- Contract, HTTP, PostgreSQL, and client parsers independently reject unknown fields, wrong chains, symbols used as addresses, uppercase or wrong-length identities, inconsistent V3/V4 identity, duplicate entries, malformed hashes, and overlong labels.
- The deterministic blocklist hash excludes the optional display label, so eligibility reconnect behavior changes only when the canonical blocked identity set changes.
- API errors use fixed envelopes. Revision conflicts return only the current user's authoritative snapshot and never expose database messages or another user's entries.
- UI action results are a closed union. Copy, filter, navigation, block mutation, and chat-draft outcomes are dispatched explicitly; display symbols and labels are never promoted to canonical intent fields.
- No untrusted HTML is rendered. Disabled commands remain non-invocable by pointer or keyboard and expose their reason through accessible menu text.
- The implementation performs no creator attribution, system-statistics work, task write, monitor write, chat send, external RPC, metadata or production-sample fetch, signing, transaction broadcast, or funds operation.
- Gitleaks 8.30.1 scanned 715 commits and approximately 21.02 MB of full history with no leaks. `pnpm audit:dependencies` reported no known vulnerabilities; exact local gate results are recorded in `command-output.md`.
