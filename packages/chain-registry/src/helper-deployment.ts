import {
  encodeAbiParameters,
  encodeDeployData,
  getAddress,
  keccak256,
  sha256,
  stringToHex,
  type Hex,
} from "viem";

import {
  WALLET_HELPER_V1_CREATION_CODE,
  WALLET_HELPER_V1_CREATION_CODE_HASH,
  WALLET_HELPER_V1_RUNTIME_BYTES,
  WALLET_HELPER_V1_RUNTIME_TEMPLATE_HASH,
} from "./wallet-helper-v1-artifact.js";

export const P05_HELPER_DEPLOYMENT_REGISTRY_VERSION = "p05-local-helper-deployment-v2" as const;
export const P05_HELPER_DEPLOYMENT_PLAN_VERSION = "p05-helper-deployment-plan-v2" as const;
export const WALLET_HELPER_V1_VERSION = "WalletHelperV1" as const;

export interface HelperDeploymentComponent {
  address: `0x${string}`;
  role: "adapter" | "permit2";
  runtimeCodeHash: `0x${string}`;
}

export interface HelperDeploymentToken {
  address: `0x${string}`;
  fixture: "TestOnlyERC20" | "TestOnlyWBNB";
  runtimeCodeHash: `0x${string}`;
}

export interface HelperBytecodeTemplate {
  abiHash: `sha256:${string}`;
  creationCode: Hex;
  creationCodeHash: `0x${string}`;
  helperVersion: typeof WALLET_HELPER_V1_VERSION;
  runtimeBytes: number;
  runtimeTemplateHash: `0x${string}`;
}

export interface HelperDeploymentRegistry {
  chainId: 31_337;
  components: readonly HelperDeploymentComponent[];
  environment: "non-forked-anvil-synthetic-only";
  executionEnabled: true;
  helperTemplate: HelperBytecodeTemplate;
  instanceBinding: "chainId+walletId+helperVersion";
  productionInheritance: false;
  registryDigest: `sha256:${string}`;
  registryVersion: typeof P05_HELPER_DEPLOYMENT_REGISTRY_VERSION;
  rollbackVersion: "p05-local-helper-deployment-disabled-v1";
  serviceFeeBps: 0;
  tokens: readonly [HelperDeploymentToken, HelperDeploymentToken];
  validFromBlock: "0";
  validToBlock: "1000000";
}

type RegistryPayload = Omit<HelperDeploymentRegistry, "registryDigest">;

const helperConstructorTypes = [
  { type: "address" },
  { type: "address" },
  { type: "address" },
  { type: "address" },
  { type: "bytes32" },
  { type: "address" },
  { type: "bytes32" },
] as const;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== "creationCode" && key !== "registryDigest")
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  }
  return value;
}

export function helperDeploymentRegistryDigest(
  registry: RegistryPayload | HelperDeploymentRegistry,
): `sha256:${string}` {
  const digest = sha256(stringToHex(JSON.stringify(canonical(registry))));
  return `sha256:${digest.slice(2)}`;
}

const registryPayload: RegistryPayload = {
  chainId: 31_337,
  components: Object.freeze([
    Object.freeze({
      address: "0x5fc8d32690cc91d4c39d9d3abcbd16989f875707",
      role: "adapter",
      runtimeCodeHash: "0xb4b2ae4ee6025275948cb04c4ab0ad52cf5e6bb016def1a2050568b812bb30f8",
    }),
    Object.freeze({
      address: "0x9fe46736679d2d9a65f0992f2272de9f3c7fa6e0",
      role: "permit2",
      runtimeCodeHash: "0x85f295c14e6e29cd939674c5f0ec10bc1606a00330ffd059e604bd231e35b7ad",
    }),
  ]),
  environment: "non-forked-anvil-synthetic-only",
  executionEnabled: true,
  helperTemplate: Object.freeze({
    abiHash: "sha256:f5457f6a9755e133e1ae1870e7ddccb70ddac316883a7f431f02c00ccb5c2623",
    creationCode: WALLET_HELPER_V1_CREATION_CODE,
    creationCodeHash: WALLET_HELPER_V1_CREATION_CODE_HASH,
    helperVersion: WALLET_HELPER_V1_VERSION,
    runtimeBytes: WALLET_HELPER_V1_RUNTIME_BYTES,
    runtimeTemplateHash: WALLET_HELPER_V1_RUNTIME_TEMPLATE_HASH,
  }),
  instanceBinding: "chainId+walletId+helperVersion",
  productionInheritance: false,
  registryVersion: P05_HELPER_DEPLOYMENT_REGISTRY_VERSION,
  rollbackVersion: "p05-local-helper-deployment-disabled-v1",
  serviceFeeBps: 0,
  tokens: Object.freeze([
    Object.freeze({
      address: "0x5fbdb2315678afecb367f032d93f642f64180aa3",
      fixture: "TestOnlyERC20",
      runtimeCodeHash: "0x438d7e29bb977ff7241816f8388a6cc0be9c4cbe4e356f177b77d71d9b7d4354",
    }),
    Object.freeze({
      address: "0xe7f1725e7734ce288f8367e1bb143e90bb3f0512",
      fixture: "TestOnlyWBNB",
      runtimeCodeHash: "0x4bd73dd3f768a57356137078198f3637e40f39b8339c36803672e3d4eae453f8",
    }),
  ]),
  validFromBlock: "0",
  validToBlock: "1000000",
};

export const P05_HELPER_DEPLOYMENT_REGISTRY: HelperDeploymentRegistry = Object.freeze({
  ...registryPayload,
  registryDigest: helperDeploymentRegistryDigest(registryPayload),
});

export function helperDeploymentComponent(
  role: HelperDeploymentComponent["role"],
  registry: HelperDeploymentRegistry = P05_HELPER_DEPLOYMENT_REGISTRY,
): HelperDeploymentComponent {
  const value = registry.components.find((component) => component.role === role);
  if (!value) throw new RangeError(`HELPER_DEPLOYMENT_COMPONENT_MISSING:${role}`);
  return value;
}

export function validateHelperDeploymentRegistry(
  registry: HelperDeploymentRegistry = P05_HELPER_DEPLOYMENT_REGISTRY,
): HelperDeploymentRegistry {
  if (
    registry.chainId !== 31_337 ||
    registry.registryVersion !== P05_HELPER_DEPLOYMENT_REGISTRY_VERSION ||
    registry.productionInheritance ||
    registry.serviceFeeBps !== 0 ||
    registry.helperTemplate.helperVersion !== WALLET_HELPER_V1_VERSION ||
    registry.helperTemplate.creationCodeHash !== WALLET_HELPER_V1_CREATION_CODE_HASH ||
    registry.registryDigest !== helperDeploymentRegistryDigest(registry) ||
    registry.components.length !== 2 ||
    registry.tokens.length !== 2
  ) {
    throw new RangeError("HELPER_DEPLOYMENT_REGISTRY_INVALID");
  }
  helperDeploymentComponent("adapter", registry);
  helperDeploymentComponent("permit2", registry);
  return registry;
}

export function buildWalletHelperV1DeploymentMaterial(
  owner: `0x${string}`,
  registry: HelperDeploymentRegistry = P05_HELPER_DEPLOYMENT_REGISTRY,
): {
  constructorArgumentsHash: `sha256:${string}`;
  initCode: Hex;
  initCodeHash: `0x${string}`;
} {
  validateHelperDeploymentRegistry(registry);
  const canonicalOwner = getAddress(owner).toLowerCase() as `0x${string}`;
  const adapter = helperDeploymentComponent("adapter", registry).address;
  const permit2 = helperDeploymentComponent("permit2", registry).address;
  const [tokenA, tokenB] = registry.tokens;
  const args = [
    canonicalOwner,
    adapter,
    permit2,
    tokenA.address,
    tokenA.runtimeCodeHash,
    tokenB.address,
    tokenB.runtimeCodeHash,
  ] as const;
  const encodedArguments = encodeAbiParameters(helperConstructorTypes, args);
  const initCode = encodeDeployData({
    abi: [{ inputs: helperConstructorTypes, stateMutability: "nonpayable", type: "constructor" }],
    args,
    bytecode: registry.helperTemplate.creationCode,
  });
  return {
    constructorArgumentsHash: `sha256:${sha256(encodedArguments).slice(2)}`,
    initCode,
    initCodeHash: keccak256(initCode),
  };
}

validateHelperDeploymentRegistry();
