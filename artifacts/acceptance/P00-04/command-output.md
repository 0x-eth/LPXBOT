# P00-04 Command Output Summary

Date: 2026-08-13 (Asia/Shanghai)  
Risk: R0

## TDD Red

Command:

```bash
node --test tests/governance/governance-checkers.test.mjs
```

Initial result: failed, 0 passed and 11 failed, because the three requested checker entrypoints did not exist. The failures were observed before checker implementation.

## Focused Green

Observed commands and results after implementation:

```text
node --test tests/governance/governance-checkers.test.mjs
  PASS  15 passed, 0 failed

node scripts/check-traceability.mjs
  PASS  196/196 unique feature IDs match

node scripts/check-doc-links.mjs
  PASS  27 relative links across 9 Markdown files

node scripts/check-baseline.mjs
  PASS  248 checksums and 247 manifest records
```

Review added coverage for a frozen baseline file omitted from `artifact-manifest.json`, a self-consistent baseline rewrite that differs from the fixed SHA anchors, a relative Markdown link with a missing heading anchor, and the CI job structure.

## Final Regression

Observed runtime for the host regression was Node.js v26.5.0 with pnpm 11.17.0. Because the host does not have the exact declared Node 22.23.1 binary, the governance tests and four checker entrypoints were also run without network access in the locally cached `node:22-alpine` image, which reported Node.js v22.23.2. They passed there.

```text
pnpm install --frozen-lockfile --offline  PASS  lockfile unchanged
pnpm check:all                          PASS  196/196; 27 links; 2 manifests
pnpm audit:dependencies                 PASS  no known vulnerabilities
pnpm format:check                       PASS
pnpm lint                               PASS  13/13 workspace tasks
pnpm typecheck                          PASS  19/19 workspace tasks
pnpm test                               PASS  5 Vitest + 15 governance tests
pnpm build                              PASS  13/13 workspace tasks
pnpm infra:up                           PASS  four services healthy
pnpm test:infra                         PASS  8 passed, 0 failed
pnpm infra:down                         PASS  containers and network removed
```

The CI workflow was parsed as YAML and checked to contain exactly four jobs, nine full-SHA Action references, read-only contents permission, concurrency cancellation, and two `always()` infrastructure cleanup steps. The frozen baseline Git tree remained `0b24a81889eb728477e583c43c9121fac7235113`, identical to the pre-task tree; the checker also validates fixed SHA-256 anchors for its manifest and checksum inventory.

The host has no Gitleaks executable, so the Gitleaks Action itself was not run locally. CI runs the full scanner with default rules; the configuration contains only path-and-rule-specific exceptions for local placeholders and immutable public client-bundle literals, with a reason on each entry.
