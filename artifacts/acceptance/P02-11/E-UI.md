# E-UI

- Pool rows expose the same 15-command registry through right-click, the more-actions icon, and `Shift+F10`; there is no second action implementation for another surface.
- Commands cover K-line/Tick expansion, pool/token address copies, same-Token search, pool/token liquidity-flow navigation, pool/token blocking, task prefill, monitor prefill, and chat prefill.
- Missing canonical identity or unavailable destination capability disables the command and supplies an accessible reason. The currently absent monitoring module is visibly disabled.
- Task and monitor actions create validated navigation intents only. Chat creates a draft intent with no send control. None reports a business-write success.
- Menu pointer events do not invoke row navigation. Arrow keys, Home, End, Enter, Escape, context-menu keys, and focus restoration follow the ARIA menu interaction model.
- The toolbar blocklist manager groups Token and pool entries, exposes individual restore controls, and presents loading, empty, saving, error, and revision-conflict states.
- Initial pool and recommendation surfaces remain gated until the matching user's authoritative blocklist loads. Changing users immediately clears the prior user's entries and ignores late loads.
- A successful mutation adopts the authoritative snapshot; a failed mutation precisely rolls back its own optimistic projection without overwriting later work.
