import { sha256, stringToHex } from "viem";

import { P05_HELPER_DEPLOYMENT_REGISTRY, WALLET_HELPER_V1_VERSION } from "./helper-deployment.js";
import { P05_LOCAL_POSITION_EXECUTION_REGISTRY } from "./local-position-execution.js";
import { localSwapComponent, P05_LOCAL_SWAP_EXECUTION_REGISTRY } from "./local-swap-execution.js";

export const P05_LOCAL_HELPER_SWEEP_REGISTRY_VERSION = "p05-local-helper-sweep-v2" as const;
export const P05_LOCAL_HELPER_RESIDUAL_SNAPSHOT_VERSION =
  "p05-local-helper-residual-snapshot-v2" as const;
export const P05_LOCAL_HELPER_SWEEP_PLAN_VERSION = "p05-local-helper-sweep-plan-v2" as const;

export type LocalHelperSweepEnvironment = "bsc" | "local" | "production" | "testnet";
export type LocalHelperSweepComponentRole = "adapter" | "manager" | "permit2" | "router";

export interface LocalHelperSweepCodeIdentity {
  address: `0x${string}`;
  role: LocalHelperSweepComponentRole;
  runtimeCodeHash: `0x${string}`;
}

export interface LocalHelperSweepTokenIdentity {
  address: `0x${string}`;
  dustBaseUnit: string;
  fixture: "TestOnlyERC20" | "TestOnlyWBNB";
  runtimeCodeHash: `0x${string}`;
}

export interface LocalHelperSweepRegistry {
  chainId: 31_337;
  components: readonly [
    LocalHelperSweepCodeIdentity,
    LocalHelperSweepCodeIdentity,
    LocalHelperSweepCodeIdentity,
    LocalHelperSweepCodeIdentity,
  ];
  dustPolicy: {
    comparison: "balance>dust";
    nativeDustBaseUnit: "1000";
    postSweep: "balance<=dust";
    tokenDustBaseUnit: "1";
    zeroBalance: "omit-operation";
  };
  environment: "non-forked-anvil-synthetic-only";
  executionEnabled: true;
  gates: Readonly<
    Record<
      LocalHelperSweepEnvironment,
      { broadcasts: boolean; signatures: boolean; status: "CLOSED" | "OPEN" }
    >
  >;
  helper: {
    abiHash: `sha256:${string}`;
    bindingRegistryVersion: "p05-local-helper-deployment-v2";
    helperVersion: typeof WALLET_HELPER_V1_VERSION;
    instanceBinding: "chainId+walletId+helperVersion";
    runtimeTemplateHash: `0x${string}`;
    selectors: {
      owner: "0x8da5cb5b";
      sweepNative: "0x6971b189";
      sweepToken: "0x3609afa9";
    };
  };
  maxAssetsPerBatch: 3;
  maxBlockDrift: 5;
  maxDeadlineSeconds: 900;
  planVersion: typeof P05_LOCAL_HELPER_SWEEP_PLAN_VERSION;
  productionInheritance: false;
  registryDigest: `sha256:${string}`;
  registryVersion: typeof P05_LOCAL_HELPER_SWEEP_REGISTRY_VERSION;
  rollbackVersion: "p05-local-helper-sweep-disabled-v1";
  serviceFeeBps: 0;
  snapshotVersion: typeof P05_LOCAL_HELPER_RESIDUAL_SNAPSHOT_VERSION;
  tokens: readonly [LocalHelperSweepTokenIdentity, LocalHelperSweepTokenIdentity];
  validFromBlock: "0";
  validToBlock: "1000000";
}

type RegistryPayload = Omit<LocalHelperSweepRegistry, "registryDigest">;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== "registryDigest")
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  }
  return value;
}

export function localHelperSweepRegistryDigest(
  registry: RegistryPayload | LocalHelperSweepRegistry,
): `sha256:${string}` {
  const value = sha256(stringToHex(JSON.stringify(canonical(registry))));
  return `sha256:${value.slice(2)}`;
}

const helperRegistry = P05_HELPER_DEPLOYMENT_REGISTRY;
const swapRegistry = P05_LOCAL_SWAP_EXECUTION_REGISTRY;
const positionRegistry = P05_LOCAL_POSITION_EXECUTION_REGISTRY;

const registryPayload: RegistryPayload = {
  chainId: 31_337,
  components: Object.freeze([
    Object.freeze({ ...localSwapComponent("adapter", swapRegistry), role: "adapter" }),
    Object.freeze({
      address: positionRegistry.manager.address,
      role: "manager",
      runtimeCodeHash: positionRegistry.manager.runtimeCodeHash,
    }),
    Object.freeze({ ...localSwapComponent("permit2", swapRegistry), role: "permit2" }),
    Object.freeze({ ...localSwapComponent("router", swapRegistry), role: "router" }),
  ]),
  dustPolicy: Object.freeze({
    comparison: "balance>dust",
    nativeDustBaseUnit: "1000",
    postSweep: "balance<=dust",
    tokenDustBaseUnit: "1",
    zeroBalance: "omit-operation",
  }),
  environment: "non-forked-anvil-synthetic-only",
  executionEnabled: true,
  gates: Object.freeze({
    bsc: Object.freeze({ broadcasts: false, signatures: false, status: "CLOSED" }),
    local: Object.freeze({ broadcasts: true, signatures: true, status: "OPEN" }),
    production: Object.freeze({ broadcasts: false, signatures: false, status: "CLOSED" }),
    testnet: Object.freeze({ broadcasts: false, signatures: false, status: "CLOSED" }),
  }),
  helper: Object.freeze({
    abiHash: helperRegistry.helperTemplate.abiHash,
    bindingRegistryVersion: helperRegistry.registryVersion,
    helperVersion: WALLET_HELPER_V1_VERSION,
    instanceBinding: helperRegistry.instanceBinding,
    runtimeTemplateHash: helperRegistry.helperTemplate.runtimeTemplateHash,
    selectors: Object.freeze({
      owner: "0x8da5cb5b",
      sweepNative: "0x6971b189",
      sweepToken: "0x3609afa9",
    }),
  }),
  maxAssetsPerBatch: 3,
  maxBlockDrift: 5,
  maxDeadlineSeconds: 900,
  planVersion: P05_LOCAL_HELPER_SWEEP_PLAN_VERSION,
  productionInheritance: false,
  registryVersion: P05_LOCAL_HELPER_SWEEP_REGISTRY_VERSION,
  rollbackVersion: "p05-local-helper-sweep-disabled-v1",
  serviceFeeBps: 0,
  snapshotVersion: P05_LOCAL_HELPER_RESIDUAL_SNAPSHOT_VERSION,
  tokens: Object.freeze(
    helperRegistry.tokens.map((token) =>
      Object.freeze({ ...token, dustBaseUnit: "1" }),
    ) as unknown as [LocalHelperSweepTokenIdentity, LocalHelperSweepTokenIdentity],
  ),
  validFromBlock: "0",
  validToBlock: "1000000",
};

export const P05_LOCAL_HELPER_SWEEP_REGISTRY: LocalHelperSweepRegistry = Object.freeze({
  ...registryPayload,
  registryDigest: localHelperSweepRegistryDigest(registryPayload),
});

export function localHelperSweepComponent(
  role: LocalHelperSweepComponentRole,
  registry: LocalHelperSweepRegistry = P05_LOCAL_HELPER_SWEEP_REGISTRY,
): LocalHelperSweepCodeIdentity {
  const component = registry.components.find((candidate) => candidate.role === role);
  if (!component) throw new RangeError(`LOCAL_HELPER_SWEEP_COMPONENT_MISSING:${role}`);
  return component;
}

export function validateLocalHelperSweepRegistry(
  registry: LocalHelperSweepRegistry = P05_LOCAL_HELPER_SWEEP_REGISTRY,
): LocalHelperSweepRegistry {
  const roles = registry.components.map(({ role }) => role).sort().join(",");
  if (
    registry.chainId !== 31_337 ||
    registry.registryVersion !== P05_LOCAL_HELPER_SWEEP_REGISTRY_VERSION ||
    registry.snapshotVersion !== P05_LOCAL_HELPER_RESIDUAL_SNAPSHOT_VERSION ||
    registry.planVersion !== P05_LOCAL_HELPER_SWEEP_PLAN_VERSION ||
    registry.environment !== "non-forked-anvil-synthetic-only" ||
    !registry.executionEnabled ||
    registry.productionInheritance ||
    registry.serviceFeeBps !== 0 ||
    registry.maxAssetsPerBatch !== 3 ||
    registry.helper.helperVersion !== WALLET_HELPER_V1_VERSION ||
    registry.helper.bindingRegistryVersion !== helperRegistry.registryVersion ||
    registry.helper.abiHash !== helperRegistry.helperTemplate.abiHash ||
    registry.helper.runtimeTemplateHash !== helperRegistry.helperTemplate.runtimeTemplateHash ||
    registry.helper.selectors.owner !== "0x8da5cb5b" ||
    registry.helper.selectors.sweepNative !== "0x6971b189" ||
    registry.helper.selectors.sweepToken !== "0x3609afa9" ||
    roles !== "adapter,manager,permit2,router" ||
    registry.components.length !== 4 ||
    registry.tokens.length !== 2 ||
    registry.dustPolicy.nativeDustBaseUnit !== "1000" ||
    registry.dustPolicy.tokenDustBaseUnit !== "1" ||
    registry.gates.local.status !== "OPEN" ||
    !registry.gates.local.signatures ||
    !registry.gates.local.broadcasts ||
    (["bsc", "testnet", "production"] as const).some(
      (environment) =>
        registry.gates[environment].status !== "CLOSED" ||
        registry.gates[environment].signatures ||
        registry.gates[environment].broadcasts,
    ) ||
    registry.registryDigest !== localHelperSweepRegistryDigest(registry)
  ) {
    throw new RangeError("LOCAL_HELPER_SWEEP_REGISTRY_INVALID");
  }

  for (const role of ["adapter", "manager", "permit2", "router"] as const) {
    localHelperSweepComponent(role, registry);
  }
  for (let index = 0; index < helperRegistry.tokens.length; index += 1) {
    const actual = registry.tokens[index];
    const expected = helperRegistry.tokens[index];
    if (
      !actual ||
      !expected ||
      actual.address !== expected.address ||
      actual.fixture !== expected.fixture ||
      actual.runtimeCodeHash !== expected.runtimeCodeHash ||
      actual.dustBaseUnit !== registry.dustPolicy.tokenDustBaseUnit
    ) {
      throw new RangeError("LOCAL_HELPER_SWEEP_REGISTRY_INVALID");
    }
  }
  return registry;
}

validateLocalHelperSweepRegistry();
