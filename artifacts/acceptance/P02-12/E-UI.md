# E-UI

- The pool toolbar exposes `创建历史` to authenticated users. Its dialog loads only on open and presents platform, result, Fee, completion time, pool identity, creator wallet when recorded, and a BscScan transaction link when present.
- History covers loading, empty, initial error, retry, stable cursor pagination, created, and `already_exists`. Closing restores focus to the trigger and aborts an active request.
- `already_exists` displays `创建时池子已存在，可能非本平台首创`. Empty attribution displays `非本平台创建，或创建于本功能上线前`; no unknown-user placeholder is invented.
- Administrator rows alone render a fixed-size creator marker. One POST batch covers the current visible, unblocked pool keys; expanded groups and applied filters create a new batch rather than row-level N+1 reads.
- Filtering, group visibility changes, session changes, and unmount abort the old generation. A late response cannot update the current lookup map.
- Creator details cover loading, record, no record, partial/malformed record, deleted user, fallback warning, global batch error, and retry states.
- Strict client parsing rejects extra/sensitive fields and malformed records before UI state is updated.

