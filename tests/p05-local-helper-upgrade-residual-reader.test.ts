import { describe, expect, it } from "vitest";

import { LocalHelperUpgradeSweepResidualReader } from "../apps/api/src/local-helper-upgrade-residual-reader.js";
import {
  MemoryLocalHelperSweepBindingStore,
  type LocalHelperResidualChainReader,
} from "../apps/api/src/local-helper-sweeps.js";
import { P05_LOCAL_HELPER_SWEEP_REGISTRY } from "../packages/chain-registry/src/index.js";

const now = new Date("2026-08-21T01:00:00.000Z");
const tenantId = "tenant-fixture-01";
const userId = "9c000000-0000-4000-8000-000000000081";
const walletId = "9c000000-0000-4000-8000-000000000082";
const walletAddress = `0x${"11".repeat(20)}` as const;
const binding = {
  adapterAddress: P05_LOCAL_HELPER_SWEEP_REGISTRY.components.find(({ role }) => role === "adapter")!
    .address,
  bindingId: "9c000000-0000-4000-8000-000000000083",
  deploymentRegistryVersion: "p05-local-helper-deployment-v2" as const,
  helperAddress: `0x${"22".repeat(20)}` as const,
  helperVersion: "WalletHelperV1" as const,
  ownerAddress: walletAddress,
  permit2Address: P05_LOCAL_HELPER_SWEEP_REGISTRY.components.find(({ role }) => role === "permit2")!
    .address,
  runtimeCodeHash: P05_LOCAL_HELPER_SWEEP_REGISTRY.helper.runtimeTemplateHash,
  state: "active" as const,
  verifiedBlockNumber: "7",
  walletId,
};
const wallet = {
  address: walletAddress,
  createdAt: now.toISOString(),
  envelopeVersion: 1,
  lockStatus: "ready" as const,
  mode: "server-kek" as const,
  name: "P05-09 read-only residual fixture",
  revision: 1,
  updatedAt: now.toISOString(),
  walletId,
};

class ResidualChainFixture implements LocalHelperResidualChainReader {
  async inspect() {
    return {
      allowances: P05_LOCAL_HELPER_SWEEP_REGISTRY.tokens.flatMap((token) =>
        P05_LOCAL_HELPER_SWEEP_REGISTRY.components.map((component) => ({
          amountBaseUnit: "0",
          spenderAddress: component.address,
          spenderRole: component.role,
          tokenAddress: token.address,
        })),
      ),
      block: {
        hash: `0x${"33".repeat(32)}` as const,
        number: "8",
        timestamp: new Date(now.getTime() - 1_000).toISOString(),
      },
      componentCode: P05_LOCAL_HELPER_SWEEP_REGISTRY.components.map(
        ({ address, role, runtimeCodeHash }) => ({ address, role, runtimeCodeHash }),
      ),
      coverage: {
        allowancesComplete: true,
        complete: true,
        helperIdentityComplete: true,
        nftCustodyComplete: true,
        tokenInventoryComplete: true,
      },
      feeLimits: [],
      headBlockNumber: "8",
      helper: { owner: walletAddress, runtimeCodeHash: binding.runtimeCodeHash },
      nativeBalanceBaseUnit: "2000",
      nftCustody: [],
      nonceViews: [{ latest: "1", pending: "1", providerId: "anvil-primary" }],
      referencedBlockHash: null,
      tokenBalances: P05_LOCAL_HELPER_SWEEP_REGISTRY.tokens.map(({ address, runtimeCodeHash }) => ({
        address,
        amountBaseUnit: "0",
        runtimeCodeHash,
      })),
      unknownTokens: [],
    };
  }
}

describe("P05-09 read-only upgrade residual scan", () => {
  it("degrades only an isolated binding copy when V1 has a sweepable balance", async () => {
    const authoritative = new MemoryLocalHelperSweepBindingStore([
      { ...binding, tenantId, userId },
    ]);
    const reader = new LocalHelperUpgradeSweepResidualReader({
      chain: new ResidualChainFixture(),
      idempotencyKey: () => "upgrade-read-only-residual-0001",
      now: () => now,
    });

    await expect(reader.scan({ binding, tenantId, userId, wallet })).resolves.toMatchObject({
      binding: { bindingId: binding.bindingId, state: "degraded" },
      degradationReasons: ["residual-above-dust"],
      manualRecoveryRequired: false,
    });
    await expect(authoritative.get({ tenantId, userId, walletId })).resolves.toMatchObject({
      bindingId: binding.bindingId,
      state: "active",
    });
  });
});
