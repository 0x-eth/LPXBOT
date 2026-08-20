# P05-08 Initial Failure Record

The first real Anvil mixed-batch run exposed temporal preview drift: preview and sweep recomputed `deadline` and `expiresAt` milliseconds apart, so an unchanged snapshot could fail with `PREVIEW_CHANGED`. Sweep validation now uses the issued preview's temporal fields while re-reading every current nonce, block, balance, Helper binding, Registry, and fee fact. An advancing-clock regression test proves that time passage alone does not invalidate unchanged content.

The first browser run exposed a separate default transport defect. `LocalHelperSweepClient` stored native `globalThis.fetch` on the instance and invoked it as an object method; Chrome rejected the wrong native receiver before issuing the local snapshot request. The default transport now calls `globalThis.fetch` through a closure while retaining the injectable fetch interface. Unit client and real Playwright tests both pass.

Visual inspection then found the mobile rescan button squeezing `本地 Helper 恢复` into a split-word heading. The local panel's small-screen heading now stacks title and command, retains stable width, and passes mobile screenshot plus horizontal-overflow checks.

All three defects were corrected before final Registry/API/Signer/Recovery tests, PostgreSQL lifecycle, real non-forked Anvil closure, desktop/mobile Playwright capture, governance checks, and repository quality gates.
