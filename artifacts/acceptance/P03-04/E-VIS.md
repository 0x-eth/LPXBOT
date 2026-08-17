# P03-04 Visual Evidence

- Desktop: `ui/history-ready-chromium-desktop.png`
- Mobile (390px): `ui/history-ready-chromium-mobile.png`

Both screenshots were captured from the real Vite `/monitors` route with local API interception. No external notification request was made.

Automated checks cover desktop table/mobile list switching, horizontal overflow, all five public status treatments, pagination, filters, the detail drawer, keyboard tab navigation, focus containment and return, and zero serious or critical axe violations.

Manual inspection confirms the desktop table remains scannable, the mobile single-column fields do not clip or overlap fixed shell navigation, long identifiers stay contained, and loading/error/empty controls have stable dimensions.
