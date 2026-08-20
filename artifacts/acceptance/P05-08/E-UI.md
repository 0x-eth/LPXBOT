# P05-08 E-UI

The wallet view retains the P05-02 BSC residual panel as a separate chainId 56 read-only section. The local section is explicitly labeled `Local Anvil 31337` and displays binding state, Helper, immutable owner, canonical block, five-part coverage, runtime/owner result, and Registry version. Eligible native, TestOnlyERC20, and WBNB balances are checkbox-selectable; exact amount and dust are visible.

Preview shows the number of independent operations, immutable owner recipient, each asset amount, per-asset gas limit/fee cap, total gas cap, and deadline. Confirmation is keyboard accessible. Submission disables the command while pending, so duplicate Enter creates one request with one stable idempotency key. The browser sends only walletId, chainId, assetIds, snapshotDigest, previewDigest, and previewToken.

Batch state progresses through queued, running, reconciling, and succeeded. Each asset renders amount/nonce, gas/fee cap, operation ID, state, reconciliation/failure reason, and full dropped/replaced/active transaction lineage. Success is shown only after the returned snapshot has an active binding and confirms canonical receipt, balances, allowance, NFT custody, code hash, and owner.

Allowance, NFT custody, and unknown Token details render as `manual-recovery-required`; selection and preview are disabled and no target/calldata editor exists. The BSC panel exposes refresh only, with no preview, sweep, rescue, signing, or broadcast entry.

`tests/e2e/p05-08-local-helper-sweep.spec.ts` runs on 1440x900 desktop and 390x844 mobile. It covers mixed-asset keyboard selection, dialog confirmation, duplicate Enter, exact payload allowlists, per-asset replacement lineage, manual recovery, BSC/local separation, serious/critical Axe violations, document overflow, and visual regression. Both projects pass.
