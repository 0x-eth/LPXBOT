import {
  chainRegistry,
  findRegisteredChain,
  type RegisteredChain,
} from "../packages/chain-registry/src/index.js";
import { describe, expect, it } from "vitest";

describe("AUTH-10 chain registry", () => {
  it("registers the five frozen-candidate chain identities in deterministic order", () => {
    expect(
      chainRegistry.map(({ chainId, displayName }) => ({ chainId, displayName })),
    ).toEqual([
      { chainId: 56, displayName: "BNB Smart Chain" },
      { chainId: 8453, displayName: "Base" },
      { chainId: 1, displayName: "Ethereum" },
      { chainId: 4663, displayName: "Robinhood Chain" },
      { chainId: 196, displayName: "X Layer" },
    ]);
  });

  it("marks one local default and reports configuration completeness without exposing values", () => {
    expect(chainRegistry.filter(({ isDefault }) => isDefault).map(({ chainId }) => chainId)).toEqual([
      56,
    ]);
    expect(
      chainRegistry.map(({ chainId, configurationComplete, missingConfiguration }) => ({
        chainId,
        configurationComplete,
        missingConfiguration,
      })),
    ).toEqual([
      { chainId: 56, configurationComplete: true, missingConfiguration: [] },
      { chainId: 8453, configurationComplete: true, missingConfiguration: [] },
      { chainId: 1, configurationComplete: true, missingConfiguration: [] },
      {
        chainId: 4663,
        configurationComplete: false,
        missingConfiguration: ["execution-adapter"],
      },
      {
        chainId: 196,
        configurationComplete: false,
        missingConfiguration: ["execution-adapter"],
      },
    ] satisfies Array<
      Pick<RegisteredChain, "chainId" | "configurationComplete" | "missingConfiguration">
    >);
  });

  it("returns no fallback chain for an unknown identifier", () => {
    expect(findRegisteredChain(999_999)).toBeNull();
  });
});
