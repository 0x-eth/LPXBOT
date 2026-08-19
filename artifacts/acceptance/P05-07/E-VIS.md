# P05-07 E-VIS

Deterministic accepted screenshots are stored under `E-VIS/`:

| State | Desktop | Mobile |
|---|---|---|
| 100% removal succeeded after decrease -> collect replacement -> burn retry | `remove-succeeded-chromium-desktop.png` (984x648) | `remove-succeeded-chromium-mobile.png` (358x1206) |

The same state is compared by Playwright against checked-in baselines in `tests/e2e/p05-07-local-position-execution.spec.ts-snapshots/` for both Chromium projects. Visual inspection confirms that expected deltas and fee/principal split remain readable, percent/slippage/burn controls do not overlap, long operation/plan/transaction identifiers wrap, replacement generations remain legible, every step status is visible, and the mobile panel has no horizontal overflow.

The desktop and mobile keyboard, Axe, and visual regression checks run in the same deterministic scenario. Screenshots contain synthetic IDs, addresses, hashes, fee values, and local operation state only. They contain no private key, Signer token, public endpoint, testnet/mainnet transaction, or real balance.
