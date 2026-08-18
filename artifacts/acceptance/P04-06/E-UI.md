# P04-06 UI Evidence

The wallet asset rows expose an icon transfer action for native currency and each supported ERC-20. The transfer dialog provides address-book selection, a canonical base-unit amount field, a fixed-size 25/50/75/MAX segmented control, and a preview-first confirmation flow.

Preview renders the exact decimal and base-unit amount, fee/gas ceiling, before/after balance effects, expected recipient amount, known/new external classification, policy/registry versions, and a live expiry countdown. New external recipients receive the dedicated security-password input only after preview; known recipients do not.

Operation rendering covers waiting for approval, queued/signing, signed, broadcast, pending, confirmed, failed, dropped, replaced, and reconciliation. Replacement generations show nonce, fee fields, transaction hash, bidirectional lineage, and exactly one active head. Unknown, expired, conflict, and reconciliation outcomes block blind repeat submission.

Playwright exercised keyboard opening, invalid scientific notation, focus on the recipient, address-book selection, Escape focus restoration, MAX ERC-20, new-address password ingress, idempotency conflict, preview expiry, status announcements, reconciliation reason, replacement lineage, and confirmation. The strict fixture now fails on every unhandled API request.

Results: the focused P04-06 suite passed 6/6 across 1440x900 desktop and 390x844 mobile projects. The complete browser gate passed 209 tests with 23 pre-existing conditional mobile skips and 0 failures. PWA passed 4/4. Axe reported no serious or critical violations, and both viewports had no horizontal document overflow.
