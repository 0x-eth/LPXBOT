# P04-02 RBAC Evidence

| Actor or boundary | Result |
|---|---|
| unauthenticated list/detail/import/generate | `UNAUTHENTICATED` |
| authenticated user without fresh reauthentication imports or generates | `REAUTH_REQUIRED` |
| current user lists or reads own custody metadata | allowed |
| current user reads another user's wallet ID | `WALLET_NOT_FOUND` |
| same user imports an active/recoverable duplicate address | `WALLET_ADDRESS_EXISTS` |
| different users import the same address | independently allowed |
| login-wallet authentication record exists | no custody wallet and no signer permission |
| API ordinary PostgreSQL adapter | metadata-only `custody_wallets` queries with `user_id = $1` |
| API to signer | loopback bearer-authenticated import/generate only |
| signer to KMS | explicit signer identity and versioned wrap/unwrap only |

The API does not import signer crypto, KMS, envelope-store, or open/decrypt modules. The worker, dispatcher, queues, Web client, and login-wallet domain receive no KEK or decryption capability.
