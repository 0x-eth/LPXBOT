# P05-04 E-OPS

The local candidate Registry has version `p05-bsc-local-execution-v1`, digest `sha256:a17fdacc4e6ff13fc6135ba090d7d280c80864ddc4b9c2530e248b249883eed4`, validity blocks 0 through 1,000,000, and rollback version `p05-bsc-local-execution-disabled-v0`. It is usable only by Foundry and non-forked local Anvil. Address, ABI hash, runtime hash, proxy implementation identity, selector, token identity, chain, version, or range mismatch rejects the context.

WalletHelperV1 is compiled with Solidity `0.8.26+commit.8a97fa7a`, Cancun EVM, optimizer enabled at 200 runs, OpenZeppelin contracts v5.4.0 commit `c64a1edb67b6e3f4a15cca8909c9482ad33a02b0`, and Permit2 commit `cc56ad0f3439c502c246fc5cfcc3db92bb8b7219`. `helper-abi-code-hashes.json` freezes each source digest, aggregate source hash, full ABI, ABI hash, creation/runtime hashes, and complete selector set.

Rollback disables the local Registry version and deploys a new reviewed Helper version rather than mutating a proxy. The production Registry never inherits local selectors. `execution-gate.json` reports local `OPEN`, testnet `CLOSED`, and production `CLOSED`. Non-zero production service fee and all production funding execution remain closed while fee authority, Router ABI/failure evidence, Token coverage, independent review, and testnet evidence are unresolved.

The six CI job equivalents are covered by quality (`format`, `lint`, `typecheck`, `test`, `build`), governance (`check:all`), browser, contracts (Foundry and Anvil), infrastructure, and security (Gitleaks plus dependency audit) commands in `command-output.md`. No production API/UI, signer route, broadcast route, or feature ownership is introduced by P05-04.
