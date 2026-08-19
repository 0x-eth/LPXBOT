# P05-07 E-REC

Collect is a one-step operation. Removal is a durable ordered saga: decrease -> collect -> optional burn. Every step has its own nonce, fencing token, semantic digest, transaction-data digest, fixed Manager target, zero value, gas limit, fee cap, and active transaction generation. Later steps remain blocked until the prior canonical receipt passes semantic and state-transition checks.

After decrease succeeds, a collect failure or transient Signer outage resumes at the collect cursor; decrease is never replayed. After collect succeeds, a burn failure resumes only at the burn cursor. Unit Worker tests explicitly restart fresh Worker instances at both cursors and assert that earlier step IDs are never sent to the Signer. The PostgreSQL test abandons/reclaims work and proves the same cursor rules durably.

Decrease principal remains `pending-collect` and unavailable while collect is pending, failed, dropped, underconfirmed, reorged, or provider-divergent. The position is not marked withdrawn in any of those states. Canonical collect promotes principal to available and separately records already-owed amounts as fee proceeds. Only successful completion of a 100% operation inserts the P05-03 withdrawn event/tombstone link.

Replacement applies only to the active step generation. It retains operation, step, nonce, plan digest, semantic digest, target, calldata digest, position, percent, and recipient while strictly increasing fees within the frozen cap. PostgreSQL evidence preserves original and replacement transaction lineage for collect. Unit observations cover dropped transactions, reorged blocks, provider divergence, underconfirmation, revert, and restart; uncertain facts enter `reconciling` instead of advancing.

Canonical postcondition failures are step-specific: wrong decrease proceeds or immediate wallet delta yields `DECREASE_POSTCONDITION_MISMATCH`; wrong collect recipient/owed/wallet delta yields `COLLECT_POSTCONDITION_MISMATCH`; nonempty or still-owned burn yields `BURN_POSTCONDITION_MISMATCH`. This prevents a successful transaction status from bypassing the position accounting invariant.
