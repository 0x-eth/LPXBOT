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

## Gate evidence boundary

The local equivalent gates in `command-output.md` establish reproducibility in the acceptance workspace. They are supporting evidence and are not labeled as Hosted CI.

- Stable implementation commit: `52aef88f99b3701ee5218a4ca1d19b051d211639`
- Hosted CI run: `31923619152`
- Hosted CI attempt: `2`
- Hosted CI completion: `2026-08-16T03:23:59.000Z`

| Hosted Job | Job ID | Conclusion |
| --- | ---: | --- |
| Quality | `95107894904` | `success` |
| Governance | `95107894873` | `success` |
| Browser | `95107894879` | `success` |
| Contracts | `95107894888` | `success` |
| Infrastructure | `95107894917` | `success` |
| Security | `95107894900` | `success` |

GitHub Actions run `31923619152` attempt 2 executed all six Jobs with non-empty steps against the stable implementation commit. Attempt 1 did not receive a runner because of the recorded billing/spending-limit condition; its empty step arrays are allocation history, not a test failure. Attempt 2 is the Hosted CI execution evidence.

No finality depth is introduced. Operations must resolve `GAP-FINALITY-DEPTH` separately before release semantics can advance.
