# P05-05 E-VIS

Deterministic visual evidence is stored under `E-VIS/`:

| State | Desktop | Mobile |
|---|---|---|
| Server-owned deployment preview | `helper-preview-chromium-desktop.png` (680x476) | `helper-preview-chromium-mobile.png` (370x694) |
| Verified succeeded operation | `helper-succeeded-chromium-desktop.png` (984x247) | `helper-succeeded-chromium-mobile.png` (358x461) |

The succeeded panel also has Playwright image baselines in `tests/e2e/p05-05-helper-deployment.spec.ts-snapshots/` and is compared with `toHaveScreenshot` on both projects. Visual review confirms that long addresses and hashes wrap inside their facts, dialog commands remain visible, the mobile two-button action row fits, and the succeeded panel is centered above the fixed status/navigation bars without clipping or overlap.

Screenshots contain synthetic addresses, deterministic hashes, local chain metadata, and operation IDs only. They contain no private key, token, production endpoint, public-chain transaction, or real balance.
