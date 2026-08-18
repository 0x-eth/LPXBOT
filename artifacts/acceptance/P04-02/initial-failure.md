# P04-02 Initial Failure Record

Tests were introduced before implementation. The initial focused run reported 19 failures across the signer, crypto, API, migration, client, and wallet UI seams because the repository still contained only the signer skeleton and no custody routes or page.

Subsequent red-green slices exposed and fixed these concrete boundary defects:

- a rejected same-user HTTP import released the active import owned by another request, allowing a third concurrent import to return 201 instead of 409;
- the production runner did not exist, so KMS/store readiness could not gate listener bind;
- API remote-signer and metadata-only PostgreSQL adapters did not exist;
- the HTTP KMS client accepted an empty base64 wrapped DEK;
- the PostgreSQL rollback fixture reused an address from the uniqueness test and failed before reaching its injected transaction fault; and
- infrastructure and migration-cycle schema inventories did not include the three new custody tables.

Each issue was reproduced by a failing test before its corresponding implementation or fixture correction. All keys and services used by these red tests were synthetic local fixtures.
