# P03-03 Data Evidence

Migration `20260818000100_create_notification_configuration.sql` adds:

- current notification preferences with a constrained six-category JSON object;
- current destination rows and append-only destination versions;
- user-scoped destination-create idempotency records; and
- current per-monitor destination bindings stamped with the monitor revision.

Destination versions are immutable through a database trigger. Deletion appends a disabled tombstone revision and removes current monitor bindings without deleting existing notification Outbox rows. Historical destination revisions remain available for already-enqueued `destinationId` and `destinationRevision` snapshots.

PostgreSQL stores credential-free configuration and an opaque `secretRef` only. Constraints reject credential field names in configuration JSON. `NotificationSecretStore` owns secret material outside PostgreSQL; missing production secret storage fails closed, and a database failure after secret creation invokes compensating deletion without leaving partial configuration.

Focused PostgreSQL coverage exercises constraints, concurrent CAS/idempotency, immutable history, tombstones, secret compensation, owner-scoped binding, and the complete migration up/down/up cycle.
