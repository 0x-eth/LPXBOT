import {
  BSC_PROTOCOL_DEPLOYMENTS,
  displayProtocolAddress,
  validateProtocolDeploymentRegistry,
  verifyProtocolDeploymentCode,
  type ProtocolDeployment,
} from "../packages/chain-registry/src/index.js";
import { keccak256 } from "viem";
import { describe, expect, it, vi } from "vitest";

describe("P02-03 BSC protocol deployment registry", () => {
  it("pins the four supported deployments without changing chain-access completeness", () => {
    expect(
      BSC_PROTOCOL_DEPLOYMENTS.map((deployment) => ({
        chainId: deployment.chainId,
        contract: deployment.factory ?? deployment.poolManager,
        generation: deployment.generation,
        platformId: deployment.platformId,
        protocolId: deployment.protocolId,
        validFromBlock: deployment.validFromBlock,
      })),
    ).toEqual([
      {
        chainId: 56,
        contract: "0xdb1d10011ad0ff90774d0c6bb92e5c5c8b4461f7",
        generation: "v3",
        platformId: "univ3",
        protocolId: 1,
        validFromBlock: "26324014",
      },
      {
        chainId: 56,
        contract: "0x0bfbcf9fa4f9c56b0f40a671ad40e0805a091865",
        generation: "v3",
        platformId: "pcsv3",
        protocolId: 2,
        validFromBlock: "26956207",
      },
      {
        chainId: 56,
        contract: "0x28e2ea090877bf75740558f6bfb36a5ffee9e9df",
        generation: "v4",
        platformId: "univ4",
        protocolId: 4,
        validFromBlock: "45970610",
      },
      {
        chainId: 56,
        contract: "0xa0ffb9c1ce1fe56963b0321b32e7a0302114058b",
        generation: "v4",
        platformId: "pcsv4",
        protocolId: 5,
        validFromBlock: "47214308",
      },
    ]);
    expect(validateProtocolDeploymentRegistry(BSC_PROTOCOL_DEPLOYMENTS)).toEqual(
      BSC_PROTOCOL_DEPLOYMENTS,
    );
  });

  it("keeps stored addresses lowercase and checksums only for display", () => {
    for (const deployment of BSC_PROTOCOL_DEPLOYMENTS) {
      const address = deployment.factory ?? deployment.poolManager;
      expect(address).toBe(address?.toLowerCase());
      expect(displayProtocolAddress(deployment)).toMatch(/^0x[0-9A-Fa-f]{40}$/u);
    }
  });

  it("rejects wrong chains, mixed contract kinds, inverted ranges, and malformed hashes", () => {
    const valid = BSC_PROTOCOL_DEPLOYMENTS[0]!;
    const invalid = [
      { ...valid, chainId: 1 },
      { ...valid, poolManager: valid.factory },
      { ...valid, validToBlock: "1" },
      { ...valid, runtimeCodeHash: "0x00" },
      { ...valid, abiHash: "sha256:not-a-hash" },
    ] satisfies ProtocolDeployment[];

    for (const deployment of invalid) {
      expect(() => validateProtocolDeploymentRegistry([deployment])).toThrowError(
        /PROTOCOL_DEPLOYMENT_INVALID/u,
      );
    }
  });

  it("fails only the mismatched protocol closed after runtime bytecode verification", async () => {
    const runtimeCode = "0x60006000" as const;
    const matching = {
      ...BSC_PROTOCOL_DEPLOYMENTS[0]!,
      runtimeCodeHash: keccak256(runtimeCode),
    };
    const mismatched = {
      ...BSC_PROTOCOL_DEPLOYMENTS[1]!,
      runtimeCodeHash: `0x${"11".repeat(32)}` as const,
    };
    const getCode = vi.fn(async () => runtimeCode);

    const result = await verifyProtocolDeploymentCode({
      chainId: 56,
      deployments: [matching, mismatched],
      getCode,
    });

    expect(result.enabled.map(({ platformId }) => platformId)).toEqual(["univ3"]);
    expect(result.failures).toEqual([
      expect.objectContaining({ platformId: "pcsv3", reason: "runtime-code-hash-mismatch" }),
    ]);
    expect(getCode).toHaveBeenCalledWith("0xdb1d10011ad0ff90774d0c6bb92e5c5c8b4461f7", "latest");
  });
});
