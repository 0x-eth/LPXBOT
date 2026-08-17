# P03-03 Visual Evidence

- Desktop: `ui/notifications-ready-chromium-desktop.png`
- Mobile (390px): `ui/notifications-ready-chromium-mobile.png`

Both images were captured from the real Vite settings route with mocked local API fixtures and no external notification request. Automated assertions cover root overflow, desktop/mobile responsive layout, keyboard operation, dialog focus and focus return, and zero serious or critical axe violations.

Manual review confirms category rows, destination metadata, action icons, switches, status feedback, write-only inputs, and fixed shell navigation remain readable without horizontal clipping. The fixed mobile shell bars seen inside the stitched full-page image are a capture artifact; viewport interaction remains constrained above the bottom navigation.
