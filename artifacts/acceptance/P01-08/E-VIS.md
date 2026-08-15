# E-VIS: Responsive and visual closeout

Evidence level: `local-fixture-verified`.

## Coverage

- Browser projects: Chromium desktop `1440x900` and mobile `390x844`.
- Boundary widths: `320`, `390`, `768`, `1024`, `1440`.
- Theme preferences: light, dark and system; the system fixture resolved against a deterministic dark OS preference.
- Route states: loading, empty, error and forbidden across all nine no-funds routes.
- Assertions: one `h1`, no horizontal overflow, no fixed-mobile-navigation overlap and axe serious/critical `0`.

The first matrix run found `.eyebrow` at `3.16:1` in dark mode because it used the light fixed gray. The rule now uses `var(--muted-foreground)`, preserving the light value while applying the existing accessible dark token.

Fourteen new screenshots are stored only under [ui/](./ui/) and classified `local-fixture-verified`. Manual inspection confirmed nonblank rendering, stable navigation tracks, readable state text and no incoherent overlap.

P01-05 and P01-06 snapshot files, masks and thresholds were not changed. Their existing strict Playwright comparisons remain the historical visual regression authority.
