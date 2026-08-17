# P02-13 UI Evidence

The strict client accepts the existing snapshot/update/heartbeat wire shape, rejects unsafe numbers, ignores duplicate and late sequences, and merges only a newer patch after a snapshot.

Authoritative zeros render as `0`. Before a snapshot, after a 503, on disconnect, or after heartbeat timeout, task values render as `--`. The watchdog is renewed from local event receipt time, not the server-provided timestamp; its timeout aborts the connection and enters the existing retry loop.

Large task counts use deterministic compact text in fixed-size status and navigation slots. The provider-owned `online` field remains `null`, so transport connectivity does not claim task-engine health.

Focused Playwright result: 2 passed across chromium-desktop and chromium-mobile.
