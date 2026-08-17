# E-VIS

- `ui/pool-actions-chromium-desktop.png` captures the 1440x900 row menu and surrounding pool table after keyboard, focus, and axe checks.
- `ui/pool-actions-chromium-mobile.png` captures the 390x844 more-actions menu after the applicable interaction, overflow, and axe checks.
- The menu is portaled and viewport-bounded, so it does not resize table columns or become clipped by the table scroller.
- Desktop context-menu and keyboard triggers restore focus to the triggering row; the icon trigger restores focus to the fixed-size icon button.
- Long canonical pool IDs and Token addresses wrap or truncate within bounded manager rows without widening the dialog or page.
- Desktop and mobile assertions report no document-level horizontal overflow and no serious or critical axe violations.
