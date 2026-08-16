# E-OPS

The production startup path uses the registry, environment-only RPC source, runtime bytecode verification and a decoder containing only enabled protocols. Chain access configuration and market decoder completeness are reported independently.

Operational controls:

- bounded request timeout, retry count, exponential delay, block span, pages per read and block-header cache;
- cursor-keyed continuation across bounded empty scan windows;
- decimal cursor/block values without JavaScript number truncation;
- deterministic offline golden regeneration;
- explicit live-capture opt-in;
- per-protocol fail closed on missing deployment/code/ABI evidence, counted by unique protocol rather than deployment-version cardinality;
- in-memory quarantine always present, with an injectable sink for persistence.

The PostgreSQL suite runs all migrations up, every down in reverse, all migrations up again and the repeatable seed. Infrastructure health/idempotence, Foundry, desktop/mobile Playwright and PWA suites also pass locally without public RPC access.

No finality depth is introduced. Operations must resolve `GAP-FINALITY-DEPTH` separately before release semantics can advance.
