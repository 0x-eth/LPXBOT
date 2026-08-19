# P05-04 E-CHAIN

## Observed BSC evidence

`evidence-matrix.json` deterministically parses all 40 byte-frozen P05-01 calldata/receipt fixtures without network access. All 40 receipts succeeded; 36 dynamic payloads begin with candidate selector `0xf2c42696`, while four payloads are empty. The common router candidate is `0x62ccef0b4545166f721caa9fee13c1d3767e27dc` with runtime hash `0xb535b72b5d56de100c08c58e8d1beedc739ccf2f842cc527285684c7ae0d29d1`; the spender snapshot is `0x2c34a2fb1d0b4f55de51e1d0bdefaddce6b7cdd6` with runtime hash `0xe8711c5f0fe7f3c28078140bb97b65aa015a58c06c14bad5abffa44f00f1ddf5`.

The fixture set has no failed candidate-selector receipt, direct call trace, authoritative Router ABI, proven recipient semantics, or canonical before/after balance calls. Transfer-log deltas are retained only as log-derived samples. The candidate receives no function name from a four-byte lookup and remains denied. P05-01 `p05-bsc-execution-v1` is byte-identical to baseline, `executionEnabled=false`, and every production Router selector allowlist remains empty.

`observed-helper-creation.json` restores the shared 19,377-byte creation input (`0xd3c67af8640b66e72ac6c0a0ad62add939676cbd2d5509ed6ba8f5a879dbba08`) from two deployment transactions. The transaction senders equal `owner()` at the deployment block. Both 19,133-byte runtimes have the same selector set but owner/self-hash immutable patch sites produce distinct runtime hashes; verified source and authoritative ABI remain unavailable, so observed Helper execution remains closed.

## Local execution evidence

The independent `p05-bsc-local-execution-v1` Registry is restricted to non-forked chainId 31337. Its deterministic WalletHelperV1 baseline has ABI hash `sha256:f5457f6a9755e133e1ae1870e7ddccb70ddac316883a7f431f02c00ccb5c2623`, creation hash `0x03d49afeaae7c230fe898e1843a3d292b3d422cf22d7ec00f3bac3ca8377e5e7`, and runtime hash `0x873594e1c8eb305e0ab059edc77107588fab87562436ca95fcacf0ef76157e8b`.

`local-anvil-snapshot.json` records one successful and one reverted call through allowlisted Router selector `0xbb05e388`. Both bind the FIX -> WBNB path, owner recipient, zero native value, amount, minOut, and exact balance/allowance before/after state. The success consumes the exact owner allowance, clears Helper/adapter allowances, leaves zero Helper/adapter input dust, and credits output to owner. The minOut failure leaves every captured balance and allowance unchanged, does not persist its plan digest, and an explicit recovery transaction resets the retained exact ingress allowance to zero.

Public execution counters: testnet signatures 0, testnet broadcasts 0, mainnet signatures 0, mainnet broadcasts 0, and real-fund operations 0.
