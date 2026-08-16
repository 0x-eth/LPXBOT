# E-SSE

- The expanded pool detail consumes the existing pools snapshot/diff stream; P02-10 adds no parallel chart stream or new event schema.
- A `pools.diff` upsert matching the expanded `poolKey` increments a refresh signal. The detail view debounces that signal by 150 ms before reloading the selected Candle bar or Tick range.
- A matching tombstone closes the detail immediately. Upserts for another pool do not reload the active chart.
- The normal 15-second refresh interval runs only while the detail is mounted and the page is visible. Visibility restoration triggers a fresh canonical read.
- Selection changes create a new request identity and abort the prior request. Request IDs and selection keys prevent a late response from replacing the current pool/bar/range state.
- Collapse, pool switch, unmount, unsupported input, fixture-state switch, and page hide clear the active request; interval and debounce cleanup are tied to React effects.
- Focused client and Playwright coverage verifies canonical `poolKey` propagation, abort, late-response suppression, SSE upsert debounce, periodic refresh, collapse, switch, and hidden-page cleanup.
