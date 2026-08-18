# E-UI

The real `/settings` route includes an OKX Key section with save, replace, test, and destructive delete commands. It renders `unconfigured`, `staged`, `testing`, `usable`, `invalid`, `revoked`, `insufficient-permission`, `unknown`, `conflict`, `deleting`, and connector-unavailable states using stable text plus the non-secret version.

All three credential controls are password inputs with autocomplete and password-manager suppression, no reveal control, and blocked copy, cut, and context-menu actions. Values are cleared before network await and on submit, cancel, validation failure, server failure, success, dialog close, component unmount, and route change. No credential fragment appears after a successful save. Delete requires a confirmation dialog and returns keyboard focus to its trigger.

The dedicated Playwright suite passed 6/6 across desktop and mobile. It covers delayed testing, all stable provider states, conflict and connector failures, secret clearing, keyboard focus, destructive confirmation, horizontal overflow, and Axe checks. Real OKX requests: 0.
