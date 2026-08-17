# P03-03 UI Evidence

`/settings` now includes six category preference switches and Telegram/Webhook destination management. The destination editor supports create/edit/delete, GET/POST selection, frozen template validation, current-user Telegram identity selection, and write-only bot-token or signing-secret inputs.

The local test button always uses `local-sink://p03-01`; the test result is transient and the draft remains unsaved until the user invokes the save command. Secret input values are never rendered after submission.

The monitor editor lists only the current user's available destinations, disables unavailable destinations, persists `destinationIds` on create/update, and shows the binding count in monitor rows.

Playwright covers loading, empty, ready, service error/retry, validation, disabled controls, revision conflict with draft preservation, deletion confirmation, keyboard focus return, and monitor binding create/edit behavior.
