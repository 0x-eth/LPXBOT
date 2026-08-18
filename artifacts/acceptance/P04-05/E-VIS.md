# P04-05 Visual Evidence

Captured with `LPBOT_CAPTURE_P04_05=1 pnpm exec playwright test tests/e2e/p04-05-wallet-assets.spec.ts --workers=1`:

| Artifact | Dimensions | Verified content |
|---|---:|---|
| `E-VIS/wallet-assets-chromium-desktop.png` | 1440 x 1523 | Asset states, exact balances, rendered QR, EIP-681 text, owned/external address groups |
| `E-VIS/wallet-assets-chromium-mobile.png` | 390 x 2757 | Responsive single-column assets, QR, forms, and address lists |
| `E-VIS/custom-rpc-chromium-desktop.png` | 1440 x 2781 | Ready state, selected chain, redacted URL, and local block height |
| `E-VIS/custom-rpc-chromium-mobile.png` | 390 x 3418 | Responsive custom RPC controls with redacted URL |

All four PNG files are non-empty 8-bit RGB images. Playwright asserted no horizontal document overflow, QR `naturalWidth > 0`, and no serious or critical Axe violations on both viewports. The sensitive fixture query marker is absent from API traffic, rendered HTML, and screenshots; the visible value is `https://rpc.fixture/<redacted>`.
