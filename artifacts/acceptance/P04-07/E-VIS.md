# E-VIS

Captured from the real Vite `/settings` route with only local route fixtures:

| Viewport | Artifact | Dimensions | Result |
|---|---|---:|---|
| desktop | `E-VIS/okx-usable-chromium-desktop.png` | 1440 x 2917 | usable state, version, replace/test/delete visible; no secret fields or fragments |
| mobile | `E-VIS/okx-usable-chromium-mobile.png` | 390 x 3670 | actions wrap without horizontal overflow; no overlap or clipped labels |

Both captures followed the save flow and were taken only after the credential dialog closed and the DOM was asserted not to contain any synthetic credential. Axe and keyboard assertions passed in the same run. Real OKX requests: 0.
