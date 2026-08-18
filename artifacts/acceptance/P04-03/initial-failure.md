# P04-03 Initial Failure Record

P04-03 tests were introduced before the implementation. Initial red runs had no Keystore password crypto module, password lifecycle store, user-password envelope mode, Keystore API, security settings UI, or password-mode wallet workflow.

Red-green slices then exposed and fixed these concrete boundary defects:

- password-mode DEKs initially lacked an independent authenticated wrap and secret version;
- unlock state was not bound to the authenticated session and signer instance;
- password rotation and encryption-mode changes needed a single optimistic PostgreSQL transaction;
- reset needed a fixed-TTL dependency snapshot and all-or-nothing destruction;
- early authentication/media-type exits could leave secret ingress buffers uncleared;
- remote and browser secret clients needed one-attempt transport and `finally` byte clearing;
- signer readiness omitted the new Keystore tables and shutdown ordering could close storage before capability cleanup;
- auto-lock updates initially returned a locked status even when the caller's bound session remained unlocked; and
- full-page settings capture produced stitched fixed-navigation overlap instead of a real Keystore viewport.

Each correction retained only synthetic passwords, wallet keys, local KMS/PostgreSQL fixtures, and intercepted browser requests. Signing, raw transaction construction, broadcast, and external RPC execution remained at zero.
