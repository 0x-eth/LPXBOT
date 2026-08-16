# E-REC

`ViemBscLogSource` resumes from the durable cursor's block and filters only already committed positions on the same branch. A removed log is retained even when its position precedes the cursor. A same-height replacement hash and a next block with a discontinuous parent are delivered unchanged to the existing canonical-store reorg path.

Mock RPC tests cover:

- bounded block-range pagination;
- header timestamp and parentHash enrichment;
- 429 and 5xx exponential backoff;
- bounded timeout retries;
- restart from the same durable cursor;
- old-branch removal, same-height replacement and discontinuous parent;
- wrong chain rejection.

P02-01 synthetic reorg/duplicate/out-of-order fixtures and P02-02 PostgreSQL canonical-store recovery remain in the full regression suite.
