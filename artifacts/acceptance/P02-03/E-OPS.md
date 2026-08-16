# E-OPS

The production startup path uses the registry, environment-only RPC source, runtime bytecode verification and a decoder containing only enabled protocols. Chain access configuration and market decoder completeness are reported independently.

Operational controls:

- bounded request timeout, retry count, exponential delay, block span and pages per read;
- decimal cursor/block values without JavaScript number truncation;
- deterministic offline golden regeneration;
- explicit live-capture opt-in;
- per-protocol fail closed on missing deployment/code/ABI evidence;
- in-memory quarantine always present, with an injectable sink for persistence.

No finality depth is introduced. Operations must resolve `GAP-FINALITY-DEPTH` separately before release semantics can advance.
