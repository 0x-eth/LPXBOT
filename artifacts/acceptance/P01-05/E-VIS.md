# E-VIS: Shell screenshot contract and manual review

## Baseline authority and evidence difference

`docs/FUNCTION_MATRIX.md` describes `SHELL-01` with the older shorthand `桌面侧栏`. P01-01 live-observed evidence is more specific and internally consistent:

- `state-catalog.json` retains the category ID `sidebar` but records `desktop horizontal shell navigation`.
- `dom-accessibility-summary.json` records desktop `header`, `nav`, and `main` landmarks and the six Chinese navigation labels.
- Its accessibility notes explicitly state that the desktop shell uses header/navigation/main landmarks while mobile uses fixed navigation.
- `screenshots/desktop-tasks-running.png` visibly places navigation in the top header, while the mobile screenshot places it at the bottom.

P01-05 therefore implements a horizontal desktop top navigation and records this evidence difference instead of creating a traditional left sidebar. The P01-01 artifact tree was not edited.

## Screenshot contract

- The first shell screenshot test was committed and run before application source changes. It failed because no approved screenshot existed; the red record is `checks/initial-visual-failure.md` at repository anchor `54edb98123fa77fe900c92cca4748a134189aed1`.
- The approved contract disables animation, hides the caret, and uses the fixed `maxDiffPixelRatio: 0.001` threshold.
- The complete `main` business-content region and `[data-visual-mask="account"]` are explicitly masked. The compared pixels are limited to the desktop header/top navigation, mobile header/bottom navigation, reserved status area, and other stable shell chrome.
- Platform-specific macOS and Linux snapshots are committed so the Linux Browser job uses a strict baseline instead of a widened cross-platform threshold.

## Pixel results

| View | Actual | Approved baseline | Result |
|---|---|---|---|
| Desktop 1440 x 900 | `visual/shell-chromium-desktop-actual.png` (`9c5363b1...d9a34e`) | Darwin `9c5363b1...d9a34e`; Linux `8646ef54...14fa` | passed at 0.001; Darwin actual is byte-identical |
| Mobile 390 x 844 | `visual/shell-chromium-mobile-actual.png` (`48abeb28...f3d03`) | Darwin `48abeb28...f3d03`; Linux `6de87275...e9a7c` | passed at 0.001; Darwin actual is byte-identical |

The saved diff images are `visual/shell-chromium-desktop-diff.png` and `visual/shell-chromium-mobile-diff.png`. Both are full black and were visually inspected as zero-difference output.

## Manual review

- Desktop: the LP Bot mark, six equal navigation tracks, five ordinary-account action controls, and reserved admin track remain on one 56-pixel header row. The account region is masked. No left sidebar is present.
- Mobile: the localized route title and action controls fit on the top row; six equal bottom tracks fit at 390 pixels and remain readable at the tested 320-pixel minimum. The masked content ends above the bottom navigation.
- The reserved desktop status row is empty and stable. No false online, gas, FPS, ping, count, or notification badge is shown.
- No shell text is clipped, no control overlaps another control, and neither viewport has horizontal overflow.
- Bright magenta areas in actual screenshots are intentional Playwright masks for business/account content and are excluded from comparison by contract.

The screenshot contract validates stable chrome only. It does not claim pixel parity for business pages excluded from P01-05.
