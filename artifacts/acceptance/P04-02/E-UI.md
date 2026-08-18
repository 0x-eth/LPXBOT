# P04-02 UI Evidence

The real Vite `/wallets` route implements `loading`, `empty`, `ready`, `import-validating`, `generate-pending`, `duplicate`, `reauth-required`, `signer-unavailable`, and generic `error` states.

Import and generate dialogs use accessible Radix focus management. The private-key input is password-typed, disables autocomplete capture, is never rendered outside its write-only field, and is cleared before validation/network await, on cancel, on server failure, and on success. Dialog close restores focus to its trigger.

Successful records show only wallet name, checksummed address, server-key mode, and custody state. Balance, Token management, address book, delete, password mode, transfer, signing, and transaction actions are intentionally absent.

The focused Playwright suite passed 8/8 desktop/mobile cases. It observes both pending states under delayed local responses, duplicate/reauth/signer/generic failures, keyboard reachability, focus return, and secret clearing.
