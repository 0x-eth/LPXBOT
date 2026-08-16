# E-REC

`ViemBscLogSource` resumes from the durable cursor's block and filters only already committed positions on the same branch. Its cursor-keyed in-memory scan watermark advances across bounded empty windows, so a long event-free range does not rescan the same pages forever. A process restart safely begins again at the durable cursor.

A removed log is retained even when its position precedes the cursor. A same-height replacement hash and a next block with a discontinuous parent are delivered unchanged to the existing canonical-store reorg path. A non-removed log whose separately fetched header belongs to another branch is rejected before normalization.

Mock RPC tests cover:

- bounded block-range pagination;
- continuation after `maxPagesPerRead` empty pages;
- RFC3339 header timestamp and parentHash enrichment;
- non-removed log/header branch consistency;
- 429 and 5xx exponential backoff;
- bounded timeout retries;
- restart from the same durable cursor;
- old-branch removal, same-height replacement and discontinuous parent;
- wrong chain rejection.

P02-01 synthetic reorg/duplicate/out-of-order fixtures and P02-02 PostgreSQL canonical-store recovery remain in the full regression suite.
