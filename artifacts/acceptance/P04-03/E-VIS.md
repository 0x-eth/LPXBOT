# P04-03 Visual Evidence

- Settings desktop, 1440 x 900: `ui/settings-keystore-chromium-desktop.png`
- Settings mobile, 390 x 844: `ui/settings-keystore-chromium-mobile.png`
- Wallets desktop, 1440 x 900: `ui/wallets-password-mode-chromium-desktop.png`
- Wallets mobile, 390 x 885: `ui/wallets-password-mode-chromium-mobile.png`

Settings captures scroll the real route to the Keystore section and preserve actual viewport behavior. Wallet captures show password-mode creation/import results, mode badges, lock state, and mode-switch controls. All captures use local route interception, disabled animation, and hidden carets.

Desktop/mobile tests assert zero horizontal overflow, keyboard reachability, initial dialog focus, Escape close, trigger focus restoration, field clearing, and zero serious or critical axe violations. Manual inspection confirms that labels, badges, addresses, controls, fixed navigation, and status content remain contained without incoherent overlap.
