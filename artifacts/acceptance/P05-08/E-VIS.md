# P05-08 E-VIS

Accepted visual captures:

| Project | Artifact | Panel dimensions | Assertions |
|---|---|---:|---|
| Chromium desktop 1440x900 | `E-VIS/sweep-succeeded-chromium-desktop.png` | 984x674 | three assets, gas/nonce facts, replacement/dropped lineage, canonical full-rescan success |
| Chromium mobile 390x844 | `E-VIS/sweep-succeeded-chromium-mobile.png` | 358x1330 | full responsive per-asset state without horizontal overflow, overlap, clipping, or split title |

The Playwright golden files live beside `tests/e2e/p05-08-local-helper-sweep.spec.ts`. Evidence captures are generated from the same successful mixed-batch state with animations disabled and caret hidden. Axe reports no serious or critical violations in the successful, manual-recovery, or BSC read-only views.

Visual review confirms that the brand-neutral operational UI remains consistent with existing wallet panels: no nested cards, stable fact grids, compact state badges, readable monospace values, fixed transaction generation rows, and an icon-plus-text rescan command. The mobile heading stacks the command below the title so `本地 Helper 恢复` remains intact.
