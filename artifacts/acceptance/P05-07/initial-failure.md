# P05-07 Initial Failure Record

The first UI integration exposed that an execution panel could not safely infer a current local Position from the existing chainId 56 read model. The execution snapshot has stronger identity requirements: wallet owner/approval, platform/tokenId, pool/ticks, liquidity/owed, Manager ABI/runtime hash, token runtime hashes, canonical block hash, expiry, Registry digest, and its own snapshot digest. `GET /api/positions/local-current` and `listCurrent` were added as an authenticated tenant/user/wallet boundary, and the UI now renders no execution controls when that exact local surface is unavailable or closed.

The initial coverage pass then showed that strict parsing indirectly rejected deadline/fee overrides and chain inspection rejected identity drift, but focused tests did not name every required branch. API/HTTP tests were expanded to exercise deadline, feeLimit, serviceFeeBps, wrong platform, unknown tokenId, stale head, changed liquidity, malicious Manager code hash, and malicious token code hash explicitly.

These gaps were corrected before the final focused unit/API/recovery runs, PostgreSQL cursor/replacement/accounting run, real Anvil platform and ordered-plan closure, Foundry contract suite, desktop/mobile Playwright capture, governance checks, and full repository gates.
