# P04-05 Initial Failure Record

The first convergence run exposed and retained the following test-first failures:

1. Root TypeScript found an unextended NodeNext import, closure narrowing of an `unknown` classification address, and a literal-only test helper parameter.
2. Root ESLint found unused fixture parameters and one unused PostgreSQL session constant.
3. Playwright found ambiguous text locators after wallet names and token symbols appeared in the new panels.
4. Axe found invalid pseudo-table row semantics because asset rows contained non-cell children and an action button.
5. The P04-02 migration test attempted to drop custody tables before rolling back the new dependent custom-token table.
6. The canonical-address test used an all-numeric address, so uppercasing did not make it non-canonical.
7. Repeat PostgreSQL runs observed prior append-only fixture audits because the assertion was not scoped to the current request marker.

The fixes added explicit type narrowing and ESM paths, scoped Playwright locators, changed asset semantics to list/listitem, rolled the dependent migration down inside the test transaction, used an alphabetic non-canonical address, and scoped audit assertions to the current process. Focused Vitest, lint, typecheck, P04-02/P04-05 Playwright, and the 23-file PostgreSQL suite then passed.
