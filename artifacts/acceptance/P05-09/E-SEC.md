# P05-09 E-SEC

The self-digesting `p05-local-helper-upgrade-v3` Registry freezes WalletHelperV1 source identity, WalletHelperV2 ABI, 18 selectors, creation code hash, runtime template hash and byte length, adapter, Permit2, TestOnly Token identities, P05-08 sweep Registry, chainId 31337, zero service fee, five-block drift, 900-second deadline, and deploy-new semantics. Proxy deployment is not present.

WalletHelperV2 retains immutable owner, adapter, Permit2, allowed Token addresses and code hashes; owner-only entry points; a nonReentrant guard; exact direct allowance or bounded Permit2 authorization; executed-plan replay protection; zero service fee; fixed owner recipient, NFT recipient, output recipient, refund recipient, and sweep recipient; adapter allowance reset; and residual refund. Unknown or code-changed Tokens fail closed.

The P05-10 typed `executeAtomicLiquidity` ABI is frozen at selector `0xe25f4c85`, but `ATOMIC_LIQUIDITY_EXECUTION_ENABLED` is immutable false and every environment's atomic liquidity gate is CLOSED. P05-09 claims only HELPER-03. HELPER-04 remains planned.

Preflight blocks degraded binding, binding/wallet mismatch, live operation, provider divergence, nonce conflict, Registry drift, source owner/runtime drift, incomplete residual coverage, and pre-existing manual recovery. Post-deployment verification requires the instance runtime hash, owner, ABI/selectors, adapter, Permit2, both Token identities, and the closed atomic gate to match the typed plan.

Exact API parsers and the independently strict web client deny bytecode, helper, target, selector, calldata, recipient, Registry override, fee override, and all unknown fields. Manual allowance/NFT/unknown-Token states produce no rescue transaction or arbitrary calldata. BSC, testnet, and production signatures and broadcasts are zero.
