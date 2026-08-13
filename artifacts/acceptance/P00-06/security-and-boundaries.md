# P00-06 Security and Boundary Evidence

## Local Dependency Audit

Executed locally with Node.js 22.23.1 and pnpm 11.17.0:

```text
pnpm audit:dependencies
PASS  No known vulnerabilities found
```

## GitHub Security Gate

GitHub Actions run <https://github.com/0x-eth/LPXBOT/actions/runs/31717321737> completed its Security job successfully at SHA `5a3d254438f416711f8aa17fc172bea2c9fd8079`:

```text
Check out full history      PASS
Gitleaks repository scan    PASS
Frozen dependency install   PASS
pnpm audit:dependencies     PASS
```

The workflow uses read-only contents permission and full-SHA Action pins. Gitleaks ran remotely against full history; it is not reported as a local execution.

## Operation Boundary

- All infrastructure endpoints were bound to `127.0.0.1`.
- Anvil used the self-contained local chain ID `31337`; Foundry configuration contains no RPC endpoint or fork URL.
- Playwright used the Vite service started on `127.0.0.1:43173`.
- No external RPC, mainnet/testnet fork, production API write, signature, transaction broadcast, or funds operation occurred.
- `.env.example` contains only local fixture credentials; the disposable `.env` was Git-ignored and remained inside the temporary worktree.
