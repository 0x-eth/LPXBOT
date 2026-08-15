# E-VIS: Responsive and accessibility evidence

Evidence level: `local-fixture-verified` only.

Playwright runs the `/pools` fixture on Chromium desktop `1440x900` and mobile `390x844`. The ready page has committed visual baselines at:

- `tests/e2e/pools.spec.ts-snapshots/pools-ready-chromium-desktop-darwin.png`
- `tests/e2e/pools.spec.ts-snapshots/pools-ready-chromium-mobile-darwin.png`
- `tests/e2e/pools.spec.ts-snapshots/pools-ready-chromium-desktop-linux.png`
- `tests/e2e/pools.spec.ts-snapshots/pools-ready-chromium-mobile-linux.png`

Acceptance screenshots have SHA-256 values:

- desktop: `a54d4190133b6cdb67b3ffc0fc8c427be7a9e63153d730e90f8ce6278aa86761`
- mobile: `03b4e9f43657024997d7dbb50f67fe43e9ba13adc9df7b1343ac15b32c53a69a`

The Linux CI baselines have SHA-256 values:

- desktop: `1951164781dbc31a9e727de38eae6a2a230c9261a852ce776964031ec0776a05`
- mobile: `8ac5e65091309168d85b9d07e1eb5c0943749f64c3a149fe36fae9155b86badf`

The browser suite checks document overflow at both viewports, arrow-key operation of the segmented radio group, all six connection/data states, and serious/critical axe violations. The serious/critical result is zero. Manual inspection confirms the table fits both viewports; mobile uses compact exact-decimal-derived labels so long FDV values do not split or overlap.
