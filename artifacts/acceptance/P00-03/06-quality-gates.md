# P00-02 Quality Gate Evidence

Runtime used for final gates:

```text
Node.js v22.23.1
pnpm 11.17.0
```

Final commands:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Final results after the P00-03 evidence package was complete:

```text
format:check  PASS  All matched files use Prettier code style
lint          PASS  13 successful / 13 total
typecheck     PASS  19 successful / 19 total
test          PASS  1 file, 5 tests passed
build         PASS  13 successful / 13 total
```

Ordinary `pnpm test` executed the existing Vitest suite only and did not invoke Compose or require Docker. Infrastructure integration tests remained isolated behind `pnpm test:infra`.
