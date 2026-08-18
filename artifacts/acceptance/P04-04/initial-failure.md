# P04-04 Initial Failure Evidence

The retained red-green sequence included these observed failures before implementation:

- signer security-password verification boundary returned HTTP 404;
- `RemoteWalletSignerClient.verifySecurityPassword` was absent;
- signer runtime ignored an injected wallet inventory and delete preview returned HTTP 503;
- the initial tombstone and preview foreign keys prevented the P04-02 custody migration from running its independent down/up cycle.

The corresponding focused tests failed for those reasons before the route, strict adapter, runtime dependency wiring, and cross-migration-safe transaction cleanup were added. Each test is retained and now passes.
