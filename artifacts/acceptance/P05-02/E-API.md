# E-API

P05-02 adds three authenticated read surfaces and one alias route:

| Method | Route | Behavior |
|---|---|---|
| `GET` | `/api/wallets/:address/positions` | Scans only registered BSC PositionManagers and returns frozen position, quarantine, coverage, cursor, and snapshot DTOs. |
| `GET` | `/api/positions/scan/:address` | Uses the same custody and canonical-snapshot boundary as the wallet route. |
| `GET` | `/api/wallets/:address/helper?chainId=56` | Resolves only a trusted internal binding and verifies Helper identity at one block. |
| `GET` | `/api/wallets/helper-residuals` | Returns the latest owned-wallet residual snapshot or `null`. |
| `POST` | `/api/wallets/helper-residuals/scan` | Starts an idempotent chain-read scan and persists a snapshot; it performs no chain write. |

Every address path is normalized and checked against the current session user's custody wallets. Cross-user and unknown wallets return the same ownership-safe denial. The routes reject client-supplied RPC URLs, providers, targets, calldata, Helper addresses, token addresses, manager addresses, allowlists, and chain IDs other than 56.

Position DTOs preserve owner, token ID, V3 pool address or V4 pool ID, ticks, liquidity, fees, approval, Manager identity, canonical block, registry version, and digest. Amounts and block numbers remain base-unit decimal strings. Unknown NFT ownership, Manager/code-hash mismatch, malformed adapter output, provider partial failure, and reorg results never enter the normal item list.

Evidence: `tests/p05-position-api.test.ts`, `tests/p05-helper-api.test.ts`, `tests/p05-position-contract.test.ts`, `tests/p05-helper-contract.test.ts`, and `tests/p05-web-read-client.test.ts`.
