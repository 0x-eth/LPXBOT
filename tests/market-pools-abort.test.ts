import { PostgresMarketPoolsProvider } from "../apps/api/src/market-pools.js";
import type { Pool, PoolClient } from "pg";
import { describe, expect, it } from "vitest";

describe("P02-09 PostgreSQL recommendation cancellation", () => {
  it("terminates an in-flight canonical snapshot query when its signal aborts", async () => {
    let releaseError: Error | boolean | undefined;
    const pending = new Promise<never>(() => undefined);
    const client = {
      query: () => pending,
      release(error?: Error | boolean) {
        releaseError = error;
      },
    } as unknown as PoolClient;
    const pool = {
      connect: async () => client,
      query: () => pending,
    } as unknown as Pool;
    const provider = new PostgresMarketPoolsProvider(pool);
    const controller = new AbortController();
    const query = provider.getTopFees({
      chainId: 56,
      minutes: 5,
      protocols: ["pcsv3", "univ3", "pcsv4", "univ4"],
      signal: controller.signal,
    });
    const outcome = Promise.race([
      query.then(
        () => "resolved",
        (error: unknown) => (error instanceof Error ? error.name : "rejected"),
      ),
      new Promise<string>((resolve) => setTimeout(() => resolve("timeout"), 20)),
    ]);

    controller.abort();
    expect(await outcome).toBe("AbortError");
    expect(releaseError).toBeInstanceOf(Error);
  });
});
