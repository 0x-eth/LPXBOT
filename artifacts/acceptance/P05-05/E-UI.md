# P05-05 E-UI

The wallet Helper area now exposes one write command: `部署 Helper`. Preview shows Local Anvil/31337, zero value, expected CREATE address, owner, adapter, Permit2, nonce, gas/fee cap, runtime hash, and expiry. Confirmation submits the opaque preview token/digest and then displays queued, signed, broadcast, pending, dropped, reconciling, confirmed, succeeded, or failed operation state. No Helper funding, Swap, approve, sweep, or arbitrary execution control is present.

The browser client strictly parses every preview/operation field, exact object shape, fee arithmetic, timestamps, UUIDs, hashes, transaction generations, and single active head. UI tests exercise stale preview disablement, API expiry, idempotency digest conflict, one-submit behavior under repeated Enter, failed operation retry, dropped/reconciling/replacement recovery, and success verification.

Playwright runs the three scenarios in both `chromium-desktop` and `chromium-mobile` for 6 passing cases. It covers keyboard open/confirm/Escape, explicit focus restoration, serious/critical Axe violations, horizontal overflow, modal error announcement, fixed-navigation geometry, request-field allowlists, and absence of other Helper writes.
