# E-UI

- The fixed status bar renders at most three recommendations. Each entry shows the token pair and `5m Fees` formatted to two display decimals while retaining the exact Decimal value on the wire.
- A missing symbol is displayed as a truncated token address. The client does not invent a token name or fetch metadata.
- Recommendation state is independent from the system stats snapshot and exposes loading, ready, empty, unavailable, reconnecting, and stale presentations.
- Each recommendation is a normal link to the existing pool search route using the canonical pool address or V4 pool ID. It creates no task, sends no mutation, and performs no funds action.
- Desktop and mobile use the same recommendation state. Mobile keeps the fixed-height bar immediately above the existing bottom navigation.

The focused P02-09 Playwright run passed the desktop and mobile rendering/navigation cases plus the desktop state matrix; the mobile duplicate of the state matrix is intentionally skipped.
