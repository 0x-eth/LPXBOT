import {
  helperDeploymentComponent,
  P05_BSC_LOCAL_EXECUTION_REGISTRY,
  P05_HELPER_DEPLOYMENT_REGISTRY,
  validateHelperDeploymentRegistry,
} from "../packages/chain-registry/src/index.js";
import {
  HELPER_DEPLOYMENT_PLAN_VERSION,
  helperDeploymentPlanDigest,
  validateHelperDeploymentPlan,
  type HelperDeploymentPlan,
  type HelperDeploymentPlanValidationContext,
} from "../packages/domain/src/helper-deployment.js";
import { encodeAbiParameters, encodeDeployData, getContractAddress, keccak256, sha256 } from "viem";
import { describe, expect, it } from "vitest";

const now = new Date("2026-08-19T16:00:00.000Z");
const walletAddress = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266" as const;
const walletId = "9b000000-0000-4000-8000-000000000001";
const operationId = "9b000000-0000-4000-8000-000000000002";
const registry = P05_HELPER_DEPLOYMENT_REGISTRY;
const adapter = helperDeploymentComponent("adapter").address;
const permit2 = helperDeploymentComponent("permit2").address;
const [tokenA, tokenB] = registry.tokens;
const nonce = 6n;
const expectedAddress = getContractAddress({
  from: walletAddress,
  nonce,
}).toLowerCase() as `0x${string}`;
const constructorTypes = [
  { type: "address" },
  { type: "address" },
  { type: "address" },
  { type: "address" },
  { type: "bytes32" },
  { type: "address" },
  { type: "bytes32" },
] as const;
const constructorArguments = [
  walletAddress,
  adapter,
  permit2,
  tokenA.address,
  tokenA.runtimeCodeHash,
  tokenB.address,
  tokenB.runtimeCodeHash,
] as const;
const encodedArguments = encodeAbiParameters(constructorTypes, constructorArguments);
const initCode = encodeDeployData({
  abi: [
    {
      inputs: constructorTypes,
      stateMutability: "nonpayable",
      type: "constructor",
    },
  ],
  args: constructorArguments,
  bytecode: registry.helperTemplate.creationCode,
});
const expectedRuntimeCodeHash = `0x${"9a".repeat(32)}` as const;

const context: HelperDeploymentPlanValidationContext = {
  adapter,
  chainId: 31_337,
  constructorArgumentsHash: `sha256:${sha256(encodedArguments).slice(2)}`,
  creationCodeHash: registry.helperTemplate.creationCodeHash,
  expectedAddress,
  expectedRuntimeCodeHash,
  helperVersion: "WalletHelperV1",
  initCode,
  initCodeHash: keccak256(initCode),
  owner: walletAddress,
  permit2,
  registryDigest: registry.registryDigest,
  registryRollbackVersion: registry.rollbackVersion,
  registryValidFromBlock: registry.validFromBlock,
  registryValidToBlock: registry.validToBlock,
  registryVersion: registry.registryVersion,
  tokenA,
  tokenB,
};

function plan(): HelperDeploymentPlan {
  const candidate: HelperDeploymentPlan = {
    chainId: 31_337,
    deadline: new Date(now.getTime() + 10 * 60 * 1_000).toISOString(),
    deployment: {
      adapter,
      constructorArgumentsHash: context.constructorArgumentsHash,
      creationCodeHash: context.creationCodeHash,
      expectedAddress,
      expectedRuntimeCodeHash,
      helperVersion: "WalletHelperV1",
      owner: walletAddress,
      permit2,
      tokenA,
      tokenB,
    },
    feeLimit: {
      feeCapBaseUnit: "2400000",
      gasLimit: "1200000",
      maxFeePerGasBaseUnit: "2",
      maxPriorityFeePerGasBaseUnit: "1",
    },
    fencingToken: "1",
    nonce: nonce.toString(),
    operationId,
    planDigest: `sha256:${"0".repeat(64)}`,
    planVersion: HELPER_DEPLOYMENT_PLAN_VERSION,
    registry: {
      blockNumber: "6",
      digest: registry.registryDigest,
      rollbackVersion: registry.rollbackVersion,
      version: registry.registryVersion,
    },
    schemaVersion: 2,
    snapshotDigest: `sha256:${"7b".repeat(32)}`,
    transaction: { data: initCode, dataHash: keccak256(initCode), to: null, valueBaseUnit: "0" },
    wallet: { address: walletAddress, walletId },
  };
  candidate.planDigest = helperDeploymentPlanDigest(candidate);
  return candidate;
}

describe("P05-05 Helper deployment contracts", () => {
  it("keeps the P05-04 registry and models WalletHelperV1 as a bytecode template", () => {
    expect(P05_BSC_LOCAL_EXECUTION_REGISTRY.registryDigest).toBe(
      "sha256:a17fdacc4e6ff13fc6135ba090d7d280c80864ddc4b9c2530e248b249883eed4",
    );
    expect(validateHelperDeploymentRegistry()).toBe(registry);
    expect(registry.registryVersion).toBe("p05-local-helper-deployment-v2");
    expect(registry.helperTemplate).not.toHaveProperty("address");
    expect(registry.components.map(({ role }) => role)).not.toContain("helper");
    expect(registry.helperTemplate.creationCodeHash).toBe(
      "0x03d49afeaae7c230fe898e1843a3d292b3d422cf22d7ec00f3bac3ca8377e5e7",
    );
  });

  it("derives the per-wallet CREATE address from owner and reserved nonce", () => {
    expect(expectedAddress).toBe("0x0165878a594ca255338adfa4d48449f69242eb8f");
    const value = plan();
    expect(value.transaction.to).toBeNull();
    expect(value.transaction.valueBaseUnit).toBe("0");
    expect(() => validateHelperDeploymentPlan(value, context, now)).not.toThrow();
  });

  it.each([
    ["chain", (value: HelperDeploymentPlan) => Object.assign(value, { chainId: 56 })],
    [
      "registry",
      (value: HelperDeploymentPlan) =>
        Object.assign(value.registry, { digest: `sha256:${"aa".repeat(32)}` }),
    ],
    [
      "creation code",
      (value: HelperDeploymentPlan) =>
        Object.assign(value.deployment, { creationCodeHash: `0x${"ab".repeat(32)}` }),
    ],
    [
      "runtime code",
      (value: HelperDeploymentPlan) =>
        Object.assign(value.deployment, { expectedRuntimeCodeHash: `0x${"ac".repeat(32)}` }),
    ],
    [
      "owner",
      (value: HelperDeploymentPlan) =>
        Object.assign(value.deployment, { owner: `0x${"11".repeat(20)}` }),
    ],
    [
      "constructor",
      (value: HelperDeploymentPlan) =>
        Object.assign(value.deployment, { constructorArgumentsHash: `sha256:${"ad".repeat(32)}` }),
    ],
    [
      "arbitrary calldata",
      (value: HelperDeploymentPlan) => Object.assign(value.transaction, { data: "0x1234" }),
    ],
    [
      "target injection",
      (value: HelperDeploymentPlan) =>
        Object.assign(value.transaction, { to: `0x${"12".repeat(20)}` }),
    ],
  ])("rejects %s tampering even with a recomputed digest", (_name, mutate) => {
    const value = plan();
    mutate(value);
    value.planDigest = helperDeploymentPlanDigest(value);
    expect(() => validateHelperDeploymentPlan(value, context, now)).toThrow();
  });
});
