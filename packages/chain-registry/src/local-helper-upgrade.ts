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
  P05_HELPER_DEPLOYMENT_REGISTRY,
  WALLET_HELPER_V1_VERSION,
} from "./helper-deployment.js";
import { P05_LOCAL_HELPER_SWEEP_REGISTRY } from "./local-helper-sweep.js";
import {
  WALLET_HELPER_V2_ABI,
  WALLET_HELPER_V2_ABI_HASH,
  WALLET_HELPER_V2_CREATION_CODE,
  WALLET_HELPER_V2_CREATION_CODE_HASH,
  WALLET_HELPER_V2_RUNTIME_BYTES,
  WALLET_HELPER_V2_RUNTIME_TEMPLATE_HASH,
  WALLET_HELPER_V2_SELECTORS,
} from "./wallet-helper-v2-artifact.js";

export const P05_LOCAL_HELPER_UPGRADE_REGISTRY_VERSION =
  "p05-local-helper-upgrade-v3" as const;
export const P05_LOCAL_HELPER_UPGRADE_SNAPSHOT_VERSION =
  "p05-local-helper-upgrade-snapshot-v3" as const;
export const P05_LOCAL_HELPER_UPGRADE_PLAN_VERSION =
  "p05-local-helper-upgrade-plan-v3" as const;
export const WALLET_HELPER_V2_VERSION = "WalletHelperV2" as const;

export type LocalHelperUpgradeEnvironment = "bsc" | "local" | "production" | "testnet";

export interface LocalHelperUpgradeRegistry {
  chainId: 31_337;
  constraints: {
    allowanceRequired: "zero";
    bindingSwitch: "single-transaction-compare-and-swap";
    liveOperationRequired: "none";
    nftCustodyRequired: "zero";
    replacementPolicy: "fee-only";
    unknownTokenRequired: "zero";
    v1PostSweep: "balance<=dust";
  };
  environment: "non-forked-anvil-synthetic-only";
  gates: Readonly<
    Record<
      LocalHelperUpgradeEnvironment,
      {
        atomicLiquidity: "CLOSED";
        broadcasts: boolean;
        signatures: boolean;
        upgrade: "CLOSED" | "OPEN";
      }
    >
  >;
  maxBlockDrift: 5;
  maxDeadlineSeconds: 900;
  productionInheritance: false;
  registryDigest: `sha256:${string}`;
  registryVersion: typeof P05_LOCAL_HELPER_UPGRADE_REGISTRY_VERSION;
  rollbackVersion: "p05-local-helper-upgrade-disabled-v1";
  serviceFeeBps: 0;
  snapshotVersion: typeof P05_LOCAL_HELPER_UPGRADE_SNAPSHOT_VERSION;
  source: {
    abiHash: `sha256:${string}`;
    bindingRegistryVersion: "p05-local-helper-deployment-v2";
    helperVersion: typeof WALLET_HELPER_V1_VERSION;
    runtimeTemplateHash: `0x${string}`;
    selectors: {
      owner: "0x8da5cb5b";
      sweepNative: "0x6971b189";
      sweepToken: "0x3609afa9";
    };
  };
  sweep: {
    registryDigest: `sha256:${string}`;
    registryVersion: "p05-local-helper-sweep-v2";
  };
  target: {
    abi: typeof WALLET_HELPER_V2_ABI;
    abiHash: typeof WALLET_HELPER_V2_ABI_HASH;
    creationCode: typeof WALLET_HELPER_V2_CREATION_CODE;
    creationCodeHash: typeof WALLET_HELPER_V2_CREATION_CODE_HASH;
    helperVersion: typeof WALLET_HELPER_V2_VERSION;
    runtimeBytes: typeof WALLET_HELPER_V2_RUNTIME_BYTES;
    runtimeTemplateHash: typeof WALLET_HELPER_V2_RUNTIME_TEMPLATE_HASH;
    selectors: typeof WALLET_HELPER_V2_SELECTORS;
  };
  planVersion: typeof P05_LOCAL_HELPER_UPGRADE_PLAN_VERSION;
  validFromBlock: "0";
  validToBlock: "1000000";
}

type RegistryPayload = Omit<LocalHelperUpgradeRegistry, "registryDigest">;

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
        .filter(
          ([key]) => key !== "abi" && key !== "creationCode" && key !== "registryDigest",
        )
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  }
  return value;
}

export function localHelperUpgradeRegistryDigest(
  registry: RegistryPayload | LocalHelperUpgradeRegistry,
): `sha256:${string}` {
  const value = sha256(stringToHex(JSON.stringify(canonical(registry))));
  return `sha256:${value.slice(2)}`;
}

const deployment = P05_HELPER_DEPLOYMENT_REGISTRY;
const sweep = P05_LOCAL_HELPER_SWEEP_REGISTRY;
const registryPayload: RegistryPayload = {
  chainId: 31_337,
  constraints: Object.freeze({
    allowanceRequired: "zero",
    bindingSwitch: "single-transaction-compare-and-swap",
    liveOperationRequired: "none",
    nftCustodyRequired: "zero",
    replacementPolicy: "fee-only",
    unknownTokenRequired: "zero",
    v1PostSweep: "balance<=dust",
  }),
  environment: "non-forked-anvil-synthetic-only",
  gates: Object.freeze({
    bsc: Object.freeze({
      atomicLiquidity: "CLOSED",
      broadcasts: false,
      signatures: false,
      upgrade: "CLOSED",
    }),
    local: Object.freeze({
      atomicLiquidity: "CLOSED",
      broadcasts: true,
      signatures: true,
      upgrade: "OPEN",
    }),
    production: Object.freeze({
      atomicLiquidity: "CLOSED",
      broadcasts: false,
      signatures: false,
      upgrade: "CLOSED",
    }),
    testnet: Object.freeze({
      atomicLiquidity: "CLOSED",
      broadcasts: false,
      signatures: false,
      upgrade: "CLOSED",
    }),
  }),
  maxBlockDrift: 5,
  maxDeadlineSeconds: 900,
  planVersion: P05_LOCAL_HELPER_UPGRADE_PLAN_VERSION,
  productionInheritance: false,
  registryVersion: P05_LOCAL_HELPER_UPGRADE_REGISTRY_VERSION,
  rollbackVersion: "p05-local-helper-upgrade-disabled-v1",
  serviceFeeBps: 0,
  snapshotVersion: P05_LOCAL_HELPER_UPGRADE_SNAPSHOT_VERSION,
  source: Object.freeze({
    abiHash: deployment.helperTemplate.abiHash,
    bindingRegistryVersion: deployment.registryVersion,
    helperVersion: WALLET_HELPER_V1_VERSION,
    runtimeTemplateHash: deployment.helperTemplate.runtimeTemplateHash,
    selectors: Object.freeze({
      owner: "0x8da5cb5b",
      sweepNative: "0x6971b189",
      sweepToken: "0x3609afa9",
    }),
  }),
  sweep: Object.freeze({
    registryDigest: sweep.registryDigest,
    registryVersion: sweep.registryVersion,
  }),
  target: Object.freeze({
    abi: WALLET_HELPER_V2_ABI,
    abiHash: WALLET_HELPER_V2_ABI_HASH,
    creationCode: WALLET_HELPER_V2_CREATION_CODE,
    creationCodeHash: WALLET_HELPER_V2_CREATION_CODE_HASH,
    helperVersion: WALLET_HELPER_V2_VERSION,
    runtimeBytes: WALLET_HELPER_V2_RUNTIME_BYTES,
    runtimeTemplateHash: WALLET_HELPER_V2_RUNTIME_TEMPLATE_HASH,
    selectors: WALLET_HELPER_V2_SELECTORS,
  }),
  validFromBlock: "0",
  validToBlock: "1000000",
};

export const P05_LOCAL_HELPER_UPGRADE_REGISTRY: LocalHelperUpgradeRegistry = Object.freeze({
  ...registryPayload,
  registryDigest: localHelperUpgradeRegistryDigest(registryPayload),
});

export function buildWalletHelperV2DeploymentMaterial(
  owner: `0x${string}`,
  registry: LocalHelperUpgradeRegistry = P05_LOCAL_HELPER_UPGRADE_REGISTRY,
): {
  constructorArgumentsHash: `sha256:${string}`;
  initCode: Hex;
  initCodeHash: `0x${string}`;
} {
  validateLocalHelperUpgradeRegistry(registry);
  const canonicalOwner = getAddress(owner).toLowerCase() as `0x${string}`;
  const adapter = deployment.components.find(({ role }) => role === "adapter")!;
  const permit2 = deployment.components.find(({ role }) => role === "permit2")!;
  const [tokenA, tokenB] = deployment.tokens;
  const args = [
    canonicalOwner,
    adapter.address,
    permit2.address,
    tokenA.address,
    tokenA.runtimeCodeHash,
    tokenB.address,
    tokenB.runtimeCodeHash,
  ] as const;
  const encodedArguments = encodeAbiParameters(helperConstructorTypes, args);
  const initCode = encodeDeployData({
    abi: registry.target.abi,
    args,
    bytecode: registry.target.creationCode,
  });
  return {
    constructorArgumentsHash: `sha256:${sha256(encodedArguments).slice(2)}`,
    initCode,
    initCodeHash: keccak256(initCode),
  };
}

export function validateLocalHelperUpgradeRegistry(
  registry: LocalHelperUpgradeRegistry = P05_LOCAL_HELPER_UPGRADE_REGISTRY,
): LocalHelperUpgradeRegistry {
  const actualSelectors = registry.target.selectors
    .map(({ selector, signature }) => `${signature}:${selector}`)
    .join("|");
  const frozenSelectors = WALLET_HELPER_V2_SELECTORS.map(
    ({ selector, signature }) => `${signature}:${selector}`,
  ).join("|");
  if (
    registry.chainId !== 31_337 ||
    registry.registryVersion !== P05_LOCAL_HELPER_UPGRADE_REGISTRY_VERSION ||
    registry.snapshotVersion !== P05_LOCAL_HELPER_UPGRADE_SNAPSHOT_VERSION ||
    registry.planVersion !== P05_LOCAL_HELPER_UPGRADE_PLAN_VERSION ||
    registry.environment !== "non-forked-anvil-synthetic-only" ||
    registry.productionInheritance ||
    registry.serviceFeeBps !== 0 ||
    registry.source.helperVersion !== WALLET_HELPER_V1_VERSION ||
    registry.source.bindingRegistryVersion !== deployment.registryVersion ||
    registry.source.abiHash !== deployment.helperTemplate.abiHash ||
    registry.source.runtimeTemplateHash !== deployment.helperTemplate.runtimeTemplateHash ||
    registry.target.helperVersion !== WALLET_HELPER_V2_VERSION ||
    registry.target.abiHash !== WALLET_HELPER_V2_ABI_HASH ||
    registry.target.creationCodeHash !== WALLET_HELPER_V2_CREATION_CODE_HASH ||
    keccak256(registry.target.creationCode) !== registry.target.creationCodeHash ||
    registry.target.runtimeTemplateHash !== WALLET_HELPER_V2_RUNTIME_TEMPLATE_HASH ||
    registry.target.runtimeBytes !== WALLET_HELPER_V2_RUNTIME_BYTES ||
    actualSelectors !== frozenSelectors ||
    registry.sweep.registryVersion !== sweep.registryVersion ||
    registry.sweep.registryDigest !== sweep.registryDigest ||
    registry.gates.local.upgrade !== "OPEN" ||
    !registry.gates.local.signatures ||
    !registry.gates.local.broadcasts ||
    Object.values(registry.gates).some(({ atomicLiquidity }) => atomicLiquidity !== "CLOSED") ||
    (["bsc", "testnet", "production"] as const).some(
      (environment) =>
        registry.gates[environment].upgrade !== "CLOSED" ||
        registry.gates[environment].signatures ||
        registry.gates[environment].broadcasts,
    ) ||
    registry.constraints.bindingSwitch !== "single-transaction-compare-and-swap" ||
    registry.constraints.replacementPolicy !== "fee-only" ||
    registry.registryDigest !== localHelperUpgradeRegistryDigest(registry)
  ) {
    throw new RangeError("LOCAL_HELPER_UPGRADE_REGISTRY_INVALID");
  }
  return registry;
}

validateLocalHelperUpgradeRegistry();
