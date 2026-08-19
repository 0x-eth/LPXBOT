# P05-04 E-SEC

WalletHelperV1 uses an immutable owner and applies `onlyOwner` plus `nonReentrant` to every asset entry. It accepts only two constructor-bound token addresses with exact runtime code hashes, only a typed adapter, and no arbitrary target, selector, or calldata. Swap output, NFT mint/output, refund, token sweep, and native sweep recipients are fixed to owner. New versions require a new Helper deployment; no proxy is used.

Direct ERC-20 allowance must equal the planned amount before pull. Helper-to-adapter and adapter-to-router allowances are set to the exact amount with OpenZeppelin SafeERC20 `forceApprove` and reset to zero. Permit2 binds token, amount, Helper spender, signature deadline, and a maximum 1,800-second expiration. Local service fee is fixed at 0 bps. Amounts are capped at `type(uint128).max`; deadline window is one day; token dust policy is one base unit.

Foundry passed 21 tests: owner/recipient enforcement, duplicate plans, exact and oversized approvals, Permit2 amount/expiration, SafeERC20 false-return/no-return/USDT-style behavior, fee-on-transfer atomic revert, callback/reentrancy, malicious adapter output, minOut, deadline, non-zero fee denial, unknown token denial, refund, sweep, dust, and revert atomicity. Fuzz ran 256 cases and the invariant suite ran 128,000 calls with zero reverts while checking Helper/adapter dust and residual internal allowance.

`token-policy.json` classifies standard, wrapped-native, false-return, no-return, USDT-style approve, fee-on-transfer, rebasing, callback/reentrant, and malformed-metadata behavior. Only exact TestOnlyERC20 and TestOnlyWBNB identities are locally executable. Unclassified production tokens remain read-only. Gitleaks and the dependency audit are recorded in `command-output.md`.
