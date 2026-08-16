# E-UI

- Each labeled pool row displays the first contract-ordered label and `+N`; activating it opens all labels, scores, stable reason codes, observations, thresholds, operators, rule version, and computation time.
- Rows with no labels render no chip and no pseudo-placeholder. Turning off `showPoolLabels` removes chips without adding a column, changing row cell counts, or changing the first ranked pool.
- The settings surface exposes a `显示池标签` switch. Its schema-v5 value updates optimistically, persists through the authenticated preference endpoint, and survives reload.
- Label rendering is downstream of the existing stream reducer. Sorting, filtering, grouping, comparison selection, and tombstone semantics continue to use their prior metric and `poolKey` rules.
- Escape returns focus to the trigger; Enter and Space open the details layer; the close control receives initial dialog focus.
