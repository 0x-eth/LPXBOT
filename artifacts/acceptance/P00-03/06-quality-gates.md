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

The final results are recorded after the P00-03 evidence package is complete. Ordinary `pnpm test` executes the existing Vitest suite only and does not invoke Compose or require Docker.
