# P05-09 E-OPS

Runtime composition fails closed unless the dedicated preview/operation stores, dual-provider chain reader, WalletHelperV1 binding source, P05-08 residual reader and sweep gateway, isolated Signer, PostgreSQL nonce and fencing repositories, receipt observer, Worker Outbox/recovery repository, and exact `p05-local-helper-upgrade-v3` Registry are present. The Registry has `productionInheritance=false` and accepts only non-forked Anvil chainId 31337.

Operational diagnosis uses the current cursor and step state, source and target binding identities, snapshot/plan/Registry digests, nonce/fencing reservation, deployment generation lineage, canonical receipt and block facts, V2 verification payload, P05-08 sweep batch and per-asset cursors, final V1 rescan, Outbox lease/attempt count, manual blockers, and audit events. API/UI operation queries expose stable status without exposing calldata or signed transport.

Recovery resumes from the persisted cursor. A confirmed V2 deployment continues at verify-v2 without signing or observing it again. A confirmed P05-08 sweep batch continues at final-rescan-v1 without recreating or replaying the batch. Before the atomic switch, WalletHelperV1 remains the recovery anchor; V2 stays `deploying` until all cleanup and verification evidence is canonical.

Replacement authorization is deploy-v2 only and fee-only. It must strictly increase fees while preserving init code, target version and address, owner, nonce, plan digest, Registry digest, ABI/creation identity, deadline, gas limit, and zero-value CREATE semantics. Dropped, replaced, failed, pending, and confirmed generations remain queryable as one lineage.

Rollback closes the local Registry with `p05-local-helper-upgrade-disabled-v1`, stops new previews/signatures/broadcasts, and preserves both Helper bindings plus all plans, evidence, transactions, sweep provenance, Outbox, and audit rows. BSC, testnet, production, and typed atomic liquidity execution remain CLOSED.
