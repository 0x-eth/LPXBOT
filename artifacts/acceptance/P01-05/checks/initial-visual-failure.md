# Initial shell visual failure

- Command: `pnpm exec playwright test tests/e2e/shell.spec.ts --project=chromium-desktop`
- Result: failed as required before implementation (exit code 1)
- Contract: `SHELL-01 keeps the observed application chrome stable`
- Failure: the approved screenshot did not yet exist; Playwright wrote `shell-chromium-desktop-actual.png`.
- Pixel policy: the initial red used `0.005`; the approved contract was tightened to
  `maxDiffPixelRatio: 0.001`, with animations disabled and caret hidden.
- Masks: the complete route `main` region and `[data-visual-mask="account"]`.
- Repository HEAD at failure: `54edb98123fa77fe900c92cca4748a134189aed1`.

This is the required red checkpoint. No application source had been changed when the command ran.
