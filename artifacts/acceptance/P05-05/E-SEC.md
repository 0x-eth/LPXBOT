# P05-05 E-SEC

The Registry separates a fixed bytecode template from the per-wallet instance binding `chainId+walletId+helperVersion`. It is restricted to non-forked Anvil chainId 31337, has `productionInheritance=false`, service fee 0, two exact synthetic token identities, fixed adapter/Permit2 identities, a frozen creation-code hash, and rollback version `p05-local-helper-deployment-disabled-v1`.

Immediately before signing, the isolated Signer reauthorizes the stored operation and rechecks plan digest/version, Registry digest/version/range/rollback, nonce and fencing token, CREATE address, `to=null`, `value=0`, complete init code and hash, creation/runtime hashes, owner/wallet equality, adapter, Permit2, and both token identities. Loopback ingress requires a fixed local HTTP endpoint, bearer token, `202 application/json`, `Cache-Control: no-store`, strict response shape, and a dedicated 64 KiB Helper-plan limit.

Receipt closure rejects a mismatched transaction hash, non-`0x0/0x1` status, noncanonical block, wrong contract address, wrong runtime hash, wrong `owner()`, wrong adapter/Permit2 constructor identity, or inconsistent binding. Tests cover wrong chain, Registry, code hash, owner, constructor, plan digest, stale fencing token, occupied CREATE address with mismatched bytecode, arbitrary target/calldata/bytecode injection, malformed Signer responses, and transport failure.

No production or testnet allowlist was added. Testnet/production signatures and broadcasts and real-fund operations remain 0.
