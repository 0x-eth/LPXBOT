# P04-02 Visual Evidence

- Desktop (1440 x 900): `ui/wallets-ready-chromium-desktop.png`
- Mobile (390 x 844): `ui/wallets-ready-chromium-mobile.png`

Both screenshots were captured from the real Vite `/wallets` route with local API interception and no external request. Capture disabled animation and hid the caret.

Automated checks found no horizontal overflow and zero serious or critical axe violations. Keyboard tests cover refresh, import, and generate controls plus dialog focus return.

Manual inspection confirms that headings and controls remain contained, the full checksummed address is readable, badges do not overlap, mobile fixed navigation does not cover wallet content, and no private key or future balance/Token/address-book/delete/transfer feature is visible.
