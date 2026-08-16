# E-DATA

`source-manifest.json` records the fixed official ABI/deployment sources, source revisions, licenses, capture times and SHA-256 values. `abi-index.json` records canonical viem ABI hashes, event signatures and topic0 values.

Every raw golden contains integer-preserving hexadecimal RPC data and decimal-string block/amount quantities. Header timestamps are converted exactly once to RFC3339 for `NormalizedPoolEvent`, matching the frozen P02-01 contract. Every normalized golden preserves amounts, ticks and liquidity as decimal strings; no floating-point conversion is used. The decoder boundary tests cover int24 tick limits, uint128 maximum liquidity, int256 minimum liquidity delta and truncated data.

Receipt token deltas are stored under `amountSignEvidence`. Exact V3 and V4 Swap relationships, V3 Mint/Collect relationships, V3 Burn direction and V4 ModifyLiquidity direction are checked before the annotation script writes the artifact.

No NFT/position identifier is synthesized from transaction order. `payload.positionId` is `null` for all supported events.

`source-manifest.json` pins the concatenated raw capture SHA-256. `sha256sums.txt` covers every P02-03 acceptance file except itself, and the offline acceptance test recomputes both inventories byte-for-byte.
