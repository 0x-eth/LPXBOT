# P03-04 Data Evidence

Migration `20260818000200_create_notification_delivery_history.sql` creates an independent `notification_delivery_history` projection with:

- immutable monitor ID/name, pool, condition summary, evaluation window, and destination ID/name/type snapshots;
- public delivery state, bounded attempt count, next-retry and delivery timestamps, stable error code, and bounded provider acknowledgement;
- indexes for the user/created tuple and user-scoped monitor and status filters; and
- a privacy foreign key that deletes history when its owning user is deleted.

The projection has no monitor, destination, candidate, or Outbox foreign key. Deleting a monitor or destination and later pruning its operational Outbox therefore retains the user-owned delivery record and its snapshots.

Enqueue, claim, expired-lease replacement recovery, retry, terminal failure, and delivery update Outbox and history in the same PostgreSQL transaction. A missing required projection row rolls the transition back. Late lease tokens update neither table.

The complete migration suite applied every migration up, all downs in reverse, and every up again. It passed 18 files / 83 tests and confirmed the history table and all existing schema/seed invariants after the second up.
