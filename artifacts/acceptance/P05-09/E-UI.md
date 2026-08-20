# P05-09 E-UI

The wallet view adds a compact Helper upgrade panel that compares WalletHelperV1 and WalletHelperV2, shows the bound source and predicted target, and provides an upgrade preview command only for the local Anvil fixture. The confirmation dialog shows all seven server-owned steps, target address, gas/fee cap, expiry, residual summary, and whether the upgrade is eligible.

After confirmation, the panel renders queued/running/completed state, current cursor, operation ID, source binding, target, nonce, plan digest, every persisted step, V1 sweep batch, and the full dropped/replaced/active deployment transaction lineage. The operation ID query retrieves an existing operation without exposing raw transaction, init code, selector, calldata, recipient, or editable fee fields.

Nonzero allowance, WalletHelperV1 NFT custody, and unknown Token states render `manual-recovery-required` with readable blockers and the retained V1 recovery address. Confirmation is disabled, no calldata editor or generic recovery command exists, and no submit request is emitted.

`tests/e2e/p05-09-local-helper-upgrade.spec.ts` runs on 1440x900 desktop and 390x844 mobile. It covers keyboard preview, confirmation, exact seven-step completion, fee-replacement lineage, strict request payloads, operation query, manual recovery, serious/critical Axe violations, horizontal overflow, visual regression, and accepted desktop/mobile evidence captures.
