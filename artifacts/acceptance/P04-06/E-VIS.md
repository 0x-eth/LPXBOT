# P04-06 Visual Evidence

Captured with `LPBOT_CAPTURE_P04_06=1 LPBOT_PLAYWRIGHT_PORT=43190 pnpm exec playwright test tests/e2e/p04-06-wallet-transfer.spec.ts --workers=1`:

| Artifact | Dimensions | Verified content |
|---|---:|---|
| `E-VIS/transfer-approval-chromium-desktop.png` | 1440 x 1483 | ERC-20 approval boundary, allocated-state summary, exact base units, and stable wallet background |
| `E-VIS/transfer-approval-chromium-mobile.png` | 390 x 2622 | Responsive approval dialog above mobile navigation with no clipped controls |
| `E-VIS/transfer-confirmed-chromium-desktop.png` | 1440 x 1483 | Confirmed native transfer, two-generation replacement lineage, and one active head |
| `E-VIS/transfer-confirmed-chromium-mobile.png` | 390 x 2622 | Stacked lineage fields, wrapped hashes, and one active head on mobile |

All four files are non-empty 8-bit RGB PNGs. Playwright asserted no unhandled API fixture requests, no horizontal document overflow, exactly one active replacement head, status live-region updates, focus restoration, and no serious or critical Axe violations. Manual pixel inspection confirmed nonblank content, no red background request failure, no overlap, and no incoherent clipping.
