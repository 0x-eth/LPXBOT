# P04-04 Visual Evidence

- Security password desktop, 1440 x 2552: `ui/security-password-chromium-desktop.png`
- Security password mobile, 390 x 3110: `ui/security-password-chromium-mobile.png`
- Wallet delete preview desktop, 1440 x 900: `ui/wallet-delete-preview-chromium-desktop.png`
- Wallet delete preview mobile, 390 x 844: `ui/wallet-delete-preview-chromium-mobile.png`

The wallet captures show a real modal over the wallet route with task, policy, asset, and position counts plus the blocked-normal-delete state and force-delete transition. The settings captures show Security Password as an independent section from Keystore Security, including version status and a conflict response.

Desktop/mobile tests assert zero horizontal overflow, stable controls, keyboard reachability, dialog focus, focus restoration, password clearing, and zero serious or critical axe violations. Manual review found no clipped labels, incoherent overlaps, or controls escaping their containers.
