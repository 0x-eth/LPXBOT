# E-REC

- HTTP reconnect coverage sends a matching `Last-Event-ID`, receives an immediate current snapshot, and rejects malformed or cross-limit cursors without applying partial state.
- Client coverage retains the last safe recommendation rows while marking the lane reconnecting or stale. It resumes with the last recommendation cursor and keeps stats sequence ordering separate.
- Duplicate cursors and older source versions in the same source window are ignored. A later canonical source version with a changed ordered payload atomically replaces the rows.
- The real PostgreSQL reorg test first projects an old-branch five-minute recommendation with `$100` Fees, then processes the orphan withdrawal and replacement branch. `PostgresMarketPoolsProvider` returns only the canonical `$40` replacement, with a higher source version and different selection hash.
- The final database assertion finds exactly one canonical `top-fees:56:5` snapshot version. Noncanonical history cannot become a recommendation source.
- Full `pnpm test:postgres` passed 11 integration files and 46 tests.
