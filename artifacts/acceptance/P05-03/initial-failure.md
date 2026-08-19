# Initial Failure

P05-03 was developed test-first across the public adapter, API, ledger, SSE, browser client, migration, and UI seams. The first P05-03 governance run occurred before status or evidence creation:

```text
node --test tests/governance/p05-03-completion.test.mjs
tests 5; pass 1; fail 4
missing: current 5/7 status, manifest, ten evidence files, screenshots, and checksum inventory
passing before evidence creation: P00 through P05-02 byte-identical 660-file baseline
```

Additional red-to-green cycles:

- The initial Playwright run could not find `Swap 报价` because the wallet panels did not exist.
- Browser submission exposed an unbound native `fetch`; binding the default browser fetch fixed the call without weakening response validation.
- Native `disabled` moved focus during asynchronous actions; guarded `aria-disabled` preserved keyboard focus.
- The migration-cycle test reported exactly seven missing expected tables before its exact inventory was updated.
- Evidence capture exposed a strict locator collision between the P05-02 source position and imported ledger row; the assertion was scoped to the ledger.

No failure was bypassed by reducing wallet ownership checks, provider validation, digest coverage, snapshot verification, cursor integrity, append-only history, or the zero-execution boundary.
