import {
  BSC_HELPER_READ_REGISTRY,
  BSC_HELPER_RESIDUAL_ALLOWLIST,
  getBscHelperReadVersion,
  validateBscHelperReadRegistry,
} from "../packages/chain-registry/src/index.js";
import { describe, expect, it } from "vitest";

describe("P05-02 trusted BSC Helper read registry", () => {
  it("binds versions to chain 56 code hashes and exact selector sets without cross-chain ordering", () => {
    expect(BSC_HELPER_READ_REGISTRY).toMatchObject({
      chainId: 56,
      currentVersion: "observed-bsc-helper-v2",
      executionEnabled: false,
      registryVersion: "p05-bsc-execution-v1",
      versionsComparableAcrossChains: false,
    });
    expect(BSC_HELPER_READ_REGISTRY.versions).toHaveLength(2);
    for (const version of BSC_HELPER_READ_REGISTRY.versions) {
      expect(version.chainId).toBe(56);
      expect(version.ownerSelector).toBe("0x8da5cb5b");
      expect(version.runtimeCodeHash).toMatch(/^0x[0-9a-f]{64}$/u);
      expect(version.requiredSelectors).toContain(version.ownerSelector);
      expect(new Set(version.requiredSelectors).size).toBe(version.requiredSelectors.length);
      expect(Object.isFrozen(version.requiredSelectors)).toBe(true);
    }
    expect(getBscHelperReadVersion("observed-bsc-helper-v1")?.runtimeCodeHash).toBe(
      "0x42795bc1467d4c1aad4704c13255eb646768885f22886c486430b30a93caebd7",
    );
    expect(getBscHelperReadVersion("unknown")).toBeNull();
    expect(() => validateBscHelperReadRegistry(BSC_HELPER_READ_REGISTRY)).not.toThrow();
  });

  it("freezes a server-owned residual allowlist and marks its known token coverage incomplete", () => {
    expect(BSC_HELPER_RESIDUAL_ALLOWLIST).toMatchObject({
      chainId: 56,
      coverageComplete: false,
      registryVersion: "p05-bsc-execution-v1",
      version: "p05-bsc-helper-residual-v1",
    });
    expect(BSC_HELPER_RESIDUAL_ALLOWLIST.tokenAddresses).toEqual([
      "0x55d398326f99059ff775485246999027b3197955",
      "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
    ]);
    expect(BSC_HELPER_RESIDUAL_ALLOWLIST.spenderAddresses).toEqual([
      "0x000000000022d473030f116ddee9f6b43ac78ba3",
      "0x2c34a2fb1d0b4f55de51e1d0bdefaddce6b7cdd6",
      "0x31c2f6fcff4f8759b3bd5bf0e1084a055615c768",
    ]);
    expect(BSC_HELPER_RESIDUAL_ALLOWLIST.nftManagerAddresses).toHaveLength(4);
    expect(Object.isFrozen(BSC_HELPER_RESIDUAL_ALLOWLIST)).toBe(true);
  });
});
