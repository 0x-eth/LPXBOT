# E-DATA

- Fee/TVL uses the existing 96-digit Decimal policy and retains the exact division result internally. Percentage display multiplies by 100 and rounds to at most four decimal places with `ROUND_HALF_EVEN`.
- Numeric range parsing and comparison use Decimal values. Enabled ranges reject null metrics even when both range bounds are empty, and inclusive min/max boundaries are deterministic.
- Unknown symbols remain unknown. Han exclusion examines only non-null token symbols and does not infer a symbol from an address, pool ID, protocol, or external metadata.
- Stored schema v3 column order is retained during migration. Unknown or duplicate entries are discarded, the first legal occurrence wins, new yield columns are appended before locked `actions`, and `pool`/`actions` are reconstructed as visible fixed edges.
- Theme, color, navigation, panel, hot-pool, scan-tab, and task-view preferences survive normalization unchanged when valid.
- Repeated migrations and repeated deterministic seed both passed. The PostgreSQL integration gate passed 11 files and 43 tests, including v3-to-v4 persistence, revision preservation, user isolation, stale-device conflict, and second-device restoration.
- P02-01 through P02-06 were verified against the pre-work 132-file SHA-256 list after browser capture and remained byte-identical.
