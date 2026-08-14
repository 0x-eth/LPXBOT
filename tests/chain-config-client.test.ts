import { ChainConfigClient } from "../apps/web/src/chain-config-client.js";
import { describe, expect, it } from "vitest";

function envelope(data: unknown, status = 200) {
  return new Response(JSON.stringify({ data, requestId: "req-chain-client", success: true }), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

describe("AUTH-10 chain configuration browser client", () => {
  it("accepts a registered but unseeded chain as off at revision zero", async () => {
    const client = new ChainConfigClient(async () =>
      envelope({
        chains: [
          {
            access: "off",
            activePositionCount: null,
            chainId: 8453,
            configurationComplete: true,
            displayName: "Base",
            isDefault: false,
            missingConfiguration: [],
            previousAccess: null,
            reason: null,
            revision: 0,
            updatedAt: null,
            updatedBy: null,
          },
        ],
      }),
    );

    await expect(client.get()).resolves.toEqual([
      expect.objectContaining({ access: "off", chainId: 8453, revision: 0 }),
    ]);
  });
});
