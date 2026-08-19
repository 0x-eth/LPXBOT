# E-OPS

Server configuration requires `BSC_POSITION_READ_RPC_URL`; the URL never appears in a browser DTO. The Registry version is frozen to `p05-bsc-execution-v1`, chainId to 56, and execution to disabled. Position, Helper, and residual services are composed through `buildApiApp` dependencies so deployments can inject the controlled RPC, trusted binding store, and bounded token/position inventories.

Migration operations are reversible. The full PostgreSQL suite exercised all migrations up, downs in reverse, a new connection, all ups again, and repeatable seed. The P04 custody-specific rollback fixture now removes the dependent Helper migration inside its transaction before recreating custody, preserving the historical migration test under the new foreign key.

Local rollback is: stop API readers, apply the P05-02 down section, restore the previous application build, and verify the prior migration set. The down section removes residual snapshots, verification snapshots, bindings, triggers, and the mutation-guard function in dependency order. No chain rollback is needed because this work item performs no chain write.

The repository does not yet provide a production RPC runner that assembles these services with live infrastructure. Production RPC runner wiring, live code-hash verification, monitoring/SLO, staging rollback rehearsal, and production allowlist/inventory coverage remain unresolved. Status remains `accepted-with-gaps`, not parity-verified and not released.

Operational counters: signing 0; broadcast 0; deployment 0; upgrade 0; sweep 0; chain writes 0; real-fund operations 0.
