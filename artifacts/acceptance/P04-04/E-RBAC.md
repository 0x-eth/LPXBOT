# P04-04 RBAC Evidence

| Actor or boundary | Result |
|---|---|
| unauthenticated wallet or security-password request | `UNAUTHENTICATED` before signer access |
| authenticated user without fresh proof on delete/password mutation | `REAUTH_REQUIRED` before signer mutation |
| user requests another user's wallet | `WALLET_NOT_FOUND` without ownership disclosure |
| stale wallet or password version | stable revision/version conflict without current secret disclosure |
| tampered, expired, consumed, or owner-mismatched preview | rejected without wallet deletion |
| normal delete with any dependency or nonzero asset | `DELETE_BLOCKED` |
| force delete without exact phrase or complete lists | confirmation or preview-change failure |
| force delete with tasks but no working coordinator | fail closed before wallet destruction |
| incomplete inventory | signer returns unavailable and creates no preview |
| API process | public metadata plus bearer-authenticated loopback signer access only |
| browser, worker, dispatcher, and queue | no KEK, DEK, private key, preview digest, or signer capability |
| internal security-password verifier | loopback signer route only; no public verification endpoint |

Delete capability binds authenticated user, wallet, revision, fresh reauthentication, one-time token digest, and a complete inventory snapshot. User-password wallet deletion revokes all matching unlock sessions and clears retained KEKs. Server-KEK deletion revokes the wallet capability without opening its Envelope.
