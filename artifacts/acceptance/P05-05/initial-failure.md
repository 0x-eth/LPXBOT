# P05-05 Initial Failure Record

The first browser execution failed before rendering the wallet page because the new Node-only Helper plan module was re-exported from the `@lpbot/domain` root used by Web code. Vite reported that `node:crypto.createHash` had been externalized for browser compatibility. The plan remains available through `@lpbot/domain/helper-deployment`; removing the unnecessary root re-export restored the browser/server module boundary.

The stale-preview scenario then found that submit errors were rendered behind a Radix modal and therefore hidden from the accessible tree. The error live region was moved into the open dialog and retained in the panel only after close. Visual review also found the first mobile element screenshot intersecting fixed navigation; the test now centers the panel in the reserved safe area and asserts its bottom is above the status bar.

These failures preceded the final passing Web typecheck, strict client tests, and 6-case desktop/mobile Playwright run.
