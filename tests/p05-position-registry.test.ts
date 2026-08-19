import {
  BSC_POSITION_READ_REGISTRY,
  getBscPositionReadDeployment,
  validateBscPositionReadRegistry,
  type BscPositionReadDeployment,
  type BscPositionReadRegistry,
} from "../packages/chain-registry/src/index.js";
import { describe, expect, it } from "vitest";

describe("P05-02 BSC position read registry", () => {
  it("freezes the four official PositionManager identities under p05-bsc-execution-v1", () => {
    expect(BSC_POSITION_READ_REGISTRY).toMatchObject({
      chainId: 56,
      executionEnabled: false,
      registryVersion: "p05-bsc-execution-v1",
      supportedChainIds: [56],
    });
    expect(
      BSC_POSITION_READ_REGISTRY.deployments.map((deployment) => ({
        generation: deployment.generation,
        platformId: deployment.platformId,
        poolIdentity: deployment.poolIdentity,
        positionManager: deployment.positionManager,
      })),
    ).toEqual([
      {
        generation: "v3",
        platformId: 1,
        poolIdentity: "poolAddress",
        positionManager: {
          address: "0x7b8a01b39d58278b5de7e48c8449c9f4f5170613",
          runtimeCodeHash:
            "0xbc0177f23ffd65c41e41fb201e170cb253489d7d637f8f6a15743a1f861160f5",
        },
      },
      {
        generation: "v3",
        platformId: 2,
        poolIdentity: "poolAddress",
        positionManager: {
          address: "0x46a15b0b27311cedf172ab29e4f4766fbe7f4364",
          runtimeCodeHash:
            "0xf64dd82357e77afddcd6dd56f4ba161f44fe90a6f72da5433f8fc6901440197f",
        },
      },
      {
        generation: "v4",
        platformId: 4,
        poolIdentity: "poolId",
        positionManager: {
          address: "0x7a4a5c919ae2541aed11041a1aeee68f1287f95b",
          runtimeCodeHash:
            "0x07867576e9a6a0fdcead21a487dce04eae6161fb350edc8c56954c09fa015ef0",
        },
      },
      {
        generation: "v4",
        platformId: 5,
        poolIdentity: "poolId",
        positionManager: {
          address: "0x55f4c8aba71a1e923edc303eb4feff14608cc226",
          runtimeCodeHash:
            "0xe8fea1721cd1cb164280e02614b06d7d8033dcc81ed6fa97f5e7cc63341d34ed",
        },
      },
    ]);
  });

  it("looks up only an exact chain, platform, registry version, and validity block", () => {
    expect(
      getBscPositionReadDeployment({
        blockNumber: "116718413",
        chainId: 56,
        platformId: 1,
        registryVersion: "p05-bsc-execution-v1",
      })?.positionManager.address,
    ).toBe("0x7b8a01b39d58278b5de7e48c8449c9f4f5170613");
    expect(
      getBscPositionReadDeployment({
        blockNumber: "116718412",
        chainId: 56,
        platformId: 1,
        registryVersion: "p05-bsc-execution-v1",
      }),
    ).toBeNull();
    expect(
      getBscPositionReadDeployment({
        blockNumber: "116718413",
        chainId: 1,
        platformId: 1,
        registryVersion: "p05-bsc-execution-v1",
      }),
    ).toBeNull();
    expect(
      getBscPositionReadDeployment({
        blockNumber: "116718413",
        chainId: 56,
        platformId: 1,
        registryVersion: "latest",
      }),
    ).toBeNull();
  });

  it("fails closed for malformed, duplicate, cross-generation, or execution-enabled entries", () => {
    const valid = BSC_POSITION_READ_REGISTRY.deployments[0]!;
    const invalidDeployments = [
      { ...valid, chainId: 1 },
      { ...valid, poolIdentity: "poolId" },
      { ...valid, positionManager: { ...valid.positionManager, address: "client-target" } },
      { ...valid, abiHash: BSC_POSITION_READ_REGISTRY.deployments[1]!.abiHash },
    ];

    for (const deployment of invalidDeployments) {
      expect(() =>
        validateBscPositionReadRegistry({
          ...BSC_POSITION_READ_REGISTRY,
          deployments: [deployment as unknown as BscPositionReadDeployment],
        }),
      ).toThrowError(/POSITION_READ_REGISTRY_INVALID/u);
    }
    expect(() =>
      validateBscPositionReadRegistry({
        ...BSC_POSITION_READ_REGISTRY,
        executionEnabled: true,
      } as unknown as BscPositionReadRegistry),
    ).toThrowError(/POSITION_READ_REGISTRY_INVALID/u);
    expect(() =>
      validateBscPositionReadRegistry({
        ...BSC_POSITION_READ_REGISTRY,
        deployments: [valid, valid],
      }),
    ).toThrowError(/POSITION_READ_REGISTRY_INVALID/u);
  });
});
