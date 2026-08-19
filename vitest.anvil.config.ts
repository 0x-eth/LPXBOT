import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: false,
    include: [
      "tests/integration/anvil-position-helper-read.integration.ts",
      "tests/integration/anvil-wallet-transfer.integration.ts",
    ],
    testTimeout: 30_000,
  },
});
