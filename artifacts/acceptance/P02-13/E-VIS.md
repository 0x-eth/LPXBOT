# P02-13 Visual Evidence

- Desktop screenshot: `ui/system-stats-chromium-desktop.png`
- Mobile screenshot: `ui/system-stats-chromium-mobile.png`

Both screenshots were produced by the focused Playwright test against the real Vite application. Assertions cover fixed badge dimensions across zero and 12.3k, fixed status-bar height, no root horizontal overflow, no status-bar vertical overflow, explicit unknown state, and zero serious/critical axe violations.

Manual review confirms desktop task counts fit without truncation and the mobile badge remains within its reserved navigation slot.
