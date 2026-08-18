# P04-03 UI Evidence

The real `/settings` route now has a Keystore security section for unconfigured, locked, unlocked, locked-out, conflict, reset-preview, and error states. It supports password creation/change, unlock, manual lock, approved 1/5/15/30/60-minute auto-lock values, reset preview, the fixed confirmation phrase, and atomic reset results.

The real `/wallets` route supports server-KEK and user-password selection for import/generation, exposes lock state, and provides optimistic bidirectional mode switching. Reset preview shows password-wallet, task, strategy, policy, position, and nonzero-asset risk counts before confirmation.

Password fields are password-typed and are cleared before validation or network await, on cancel, on success, and on every mapped failure. Password values are absent from the URL, `localStorage`, rendered error text, telemetry, and response DTOs. Secret clients clear encoded request bytes in `finally` and do not retry.

The focused P04-03 Playwright suite passed 6/6 desktop/mobile cases. The P04-02 wallet regression passed 8/8 when run independently.
