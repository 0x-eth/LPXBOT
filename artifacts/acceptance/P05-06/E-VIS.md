# P05-06 E-VIS

Deterministic accepted screenshots are stored under `E-VIS/`:

| State | Desktop | Mobile |
|---|---|---|
| Direct Swap succeeded with all ordered steps and replacement lineage | `direct-succeeded-chromium-desktop.png` (984x640) | `direct-succeeded-chromium-mobile.png` (358x1165) |

The same state is compared by Playwright against checked-in baselines in `tests/e2e/p05-06-local-swap-execution.spec.ts-snapshots/` for both projects. Visual inspection confirms that operation/plan identifiers wrap, step facts remain aligned, replacement generations remain legible, cleanup skipped state remains explicit, and the mobile panel has no horizontal overflow or control overlap.

The screenshots contain synthetic IDs, addresses, hashes, fee values, and local operation state only. They contain no private key, signer token, public endpoint, testnet/mainnet transaction, or real balance.
