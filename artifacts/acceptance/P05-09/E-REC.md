# P05-09 E-REC

The durable cursor is exactly preflight -> deploy-v2 -> verify-v2 -> sweep-v1 -> final-rescan-v1 -> atomic-binding-switch -> completed. Each transition compare-and-swaps the expected operation cursor and step state, persists its evidence, and enqueues only the next cursor. Worker leases are reclaimable after process death.

If raw deployment delivery succeeds and persistence fails, retry submits the identical generation and deterministic signed transaction; already-known transport prevents a second chain action. Once the canonical deployment receipt is stored, restart proceeds to V2 verification without signing or deployment observation. Once the provenance-bound P05-08 sweep batch is confirmed, restart proceeds to the final V1 rescan without recreating or replaying sweep operations.

Deployment replacement can increase max fee and priority fee only. Init code/hash, ABI and creation identity, target WalletHelperV2 and predicted address, owner, nonce, source binding, Registry/snapshot/plan digests, deadline, gas limit, and zero value are immutable. Original and replacement generations remain in the operation lineage.

V1 may be superseded only after complete coverage shows every balance at or below dust, all allowances zero, NFT custody empty, unknown Token inventory empty, exact owner/runtime/component/token/Registry identities, and no live operation. Nonzero allowance, NFT custody, or unknown Token enters `manual-recovery-required`; it does not advance the binding switch and no arbitrary recovery calldata is generated.

The SERIALIZABLE final transaction revalidates V2 and V1 evidence and atomically writes V1 `superseded`, V2 `active`, and operation `completed`. A duplicate switch loses its compare-and-swap. PostgreSQL and real Anvil integration tests prove the final one-active-binding invariant and no nonce movement after completed restart.
