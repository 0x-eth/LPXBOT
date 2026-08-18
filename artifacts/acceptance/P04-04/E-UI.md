# P04-04 UI Evidence

The real `/wallets` route now supports rename, delete preview, normal delete, and force delete. The preview explicitly presents task, policy, nonzero-asset, and position risk counts. Force deletion advances to a separate confirmation dialog that requires the exact server phrase and displays the complete frozen dependency lists.

Wallet UI coverage includes `ready`, `conflict`, `delete-blocked`, `preview-expired`, `deleting`, `deleted`, and generic error states. Dialogs are keyboard reachable, establish deterministic initial focus, close with Escape where safe, and restore focus to the invoking wallet action. A preview-to-force transition transfers focus without leaving it in a hidden dialog.

The real `/settings` route has a separate Security Password section below Keystore Security. It covers `security-unconfigured`, ready, locked-out, conflict, saving, and error states. Creation and change require fresh reauthentication at the API. Every old/new/confirmation password field is cleared on submit before network await, and on cancel, success, validation failure, and server failure.

The capture-mode P04-04 Playwright suite passed 10/10 desktop/mobile tests. The combined P04-02/P04-03/P04-04 regression passed 24/24 tests.
