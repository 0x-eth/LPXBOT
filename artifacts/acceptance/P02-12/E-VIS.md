# E-VIS

- `ui/pool-provenance-chromium-desktop.png` captures the 1440x900 creation-history dialog with created and already-exists records.
- `ui/pool-provenance-chromium-mobile.png` captures the same workflow at 390x844 with wrapped canonical identities and no document-level horizontal overflow.
- Radix dialog semantics provide an accessible title, focus trap, Escape/close behavior, and trigger focus restoration. The close control receives initial dialog focus.
- Creator markers retain a stable 30x30 action-cell footprint across loading, created, fallback, null, malformed, and error states.
- Focused Playwright assertions report no serious or critical axe violations on desktop or mobile.
- Visual inspection confirmed that result badges, Fee/time facts, wallet/hash values, the transaction command, warning text, and mobile navigation do not overlap.

