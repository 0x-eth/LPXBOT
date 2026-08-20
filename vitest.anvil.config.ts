import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: false,
    include: [
      "tests/integration/anvil-position-helper-read.integration.ts",
      "tests/integration/anvil-p05-04-execution-safety.integration.ts",
      "tests/integration/anvil-wallet-transfer.integration.ts",
      "tests/integration/anvil-helper-deployment.integration.ts",
      "tests/integration/anvil-local-swap-execution.integration.ts",
      "tests/integration/anvil-local-position-execution.integration.ts",
      "tests/integration/anvil-local-helper-sweep.integration.ts",
      "tests/integration/anvil-local-helper-upgrade.integration.ts",
    ],
    testTimeout: 30_000,
  },
});
