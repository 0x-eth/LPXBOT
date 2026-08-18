# P04-03 RBAC Evidence

| Actor or boundary | Result |
|---|---|
| unauthenticated Keystore or wallet request | `UNAUTHENTICATED` before signer access |
| authenticated user without fresh proof on a secret mutation | `REAUTH_REQUIRED` before signer access |
| unlocked user with a different authenticated session | no unlock capability |
| signer process after restart | all user-password wallets start locked |
| wrong password, absent Keystore, or corrupt password-mode material | uniform `INVALID_CREDENTIALS` |
| five failures for one user/session | only that user/session is locked out |
| user requests another user's wallet | `WALLET_NOT_FOUND` without ownership disclosure |
| password rotation or mode switch | optimistic secret and wallet versions enforced |
| reset | only current user's password-mode recovery material is destroyed |
| server-KEK wallet | unaffected by user-password lockout, password change, or reset |
| API process | metadata/public DTO access plus loopback bearer-authenticated signer calls |
| worker, dispatcher, queue, and browser | no KEK, DEK, private-key, or signer capability |

Unlock state is held only by the isolated signer and binds `userId`, `reauthenticatedSessionId`, signer instance, secret version, and unlock version. Manual lock, auto-lock, password commit, mode switch, reset, and process shutdown revoke matching capabilities and clear retained KEKs.
