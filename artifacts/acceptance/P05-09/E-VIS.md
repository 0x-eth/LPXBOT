# P05-09 E-VIS

Accepted visual captures:

| Project | Artifact | Assertions |
|---|---|---|
| Chromium desktop 1440x900 | `E-VIS/upgrade-completed-chromium-desktop.png` | V1/V2 comparison, completed seven-step cursor, V1 sweep provenance, G0/G1 replacement lineage |
| Chromium mobile 390x844 | `E-VIS/upgrade-completed-chromium-mobile.png` | responsive facts, steps, operation status, and lineage without horizontal overflow or overlap |

The Playwright golden files live beside `tests/e2e/p05-09-local-helper-upgrade.spec.ts`. Evidence captures use the same completed fixture with animations disabled and caret hidden. Axe reports no serious or critical violations in completed and manual-recovery views.

Visual review confirms stable compact headings, fact grids, step dimensions, transaction generation rows, code wrapping, keyboard focus, dialog containment, readable blockers, and no nested-card or decorative marketing treatment. The longest identifiers remain inside their parent at both viewports.
