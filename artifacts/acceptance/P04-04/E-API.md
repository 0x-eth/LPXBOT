# P04-04 API Evidence

The authenticated wallet lifecycle surface is:

- `PATCH /api/wallets/:walletId`
- `POST /api/wallets/:walletId/delete-preview`
- `DELETE /api/wallets/:walletId`

The delete-preview endpoint is a P04-04 `LOCAL-DECISION`; P04-01 reference artifacts are unchanged. Rename accepts only `name` and `expectedRevision`, enforces the 1..80 code-point boundary, rejects leading/trailing whitespace and control characters, preserves revision on no-op, and returns `REVISION_CONFLICT` on stale writes. Owner predicates converge cross-user access on `WALLET_NOT_FOUND`. Rename neither opens an Envelope nor invokes signing code.

Delete previews have a fixed 300-second lifetime and bind user, wallet, revision, complete task/policy/position/asset lists, counts, `assetRiskDigest`, `forceEligible`, confirmation phrase, and expiry. Only the SHA-256 token digest is persisted. Every delete requires the current one-time token, `expectedRevision`, and fresh reauthentication. Normal delete requires a zero dependency snapshot. Force delete additionally requires `force=true`, the exact server phrase, the complete frozen dependency lists, and successful task deactivation.

The security-password surface is:

- `GET /api/security-password/status`
- `PUT /api/security-password`

Secret mutation uses `application/vnd.lpbot.security-password-secret+json`, `Cache-Control: no-store`, a 16 KiB limit, one transport attempt, and mutable-buffer cleanup. Responses contain exactly `configured`, `version`, and `status`. `POST /v1/security-password/verify` is a loopback signer-only port with a strict `{ verified: true, version }` receipt; no public `/api/security-password/verify` route exists.

Focused lifecycle, security-password, client, signer HTTP, and adapter coverage is included in the 19-file / 93-test regression.

Private-key decryptions: 0. Signing operations: 0. Raw transaction operations: 0. Broadcast calls: 0. External RPC calls: 0.
