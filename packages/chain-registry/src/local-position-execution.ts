import { sha256, stringToHex } from "viem";

import { P05_HELPER_DEPLOYMENT_REGISTRY } from "./helper-deployment.js";

export const P05_LOCAL_POSITION_EXECUTION_REGISTRY_VERSION =
  "p05-local-position-execution-v2" as const;
export const P05_LOCAL_POSITION_SNAPSHOT_VERSION = "p05-local-position-snapshot-v2" as const;
export const P05_LOCAL_POSITION_PLAN_VERSION = "p05-local-position-plan-v2" as const;

export type LocalPositionPlatformId = 1 | 2 | 4 | 5;
export type LocalPositionEnvironment = "bsc" | "local" | "production" | "testnet";

export interface LocalPositionExecutionRegistry {
  chainId: 31_337;
  environment: "non-forked-anvil-synthetic-only";
  executionEnabled: true;
  gates: Readonly<
    Record<
      LocalPositionEnvironment,
      { broadcasts: boolean; signatures: boolean; status: "CLOSED" | "OPEN" }
    >
  >;
  manager: {
    abiHash: `sha256:${string}`;
    address: `0x${string}`;
    runtimeCodeHash: `0x${string}`;
    selectors: {
      burn: "0x42966c68";
      collect: "0xfc6f7865";
      decreaseLiquidity: "0x0c49ccbe";
    };
  };
  maxBlockDrift: 5;
  maxDeadlineSeconds: 900;
  maxSlippageBps: 500;
  platforms: readonly {
    generation: "v3" | "v4";
    platformId: LocalPositionPlatformId;
  }[];
  planVersion: typeof P05_LOCAL_POSITION_PLAN_VERSION;
  productionInheritance: false;
  registryDigest: `sha256:${string}`;
  registryVersion: typeof P05_LOCAL_POSITION_EXECUTION_REGISTRY_VERSION;
  rollbackVersion: "p05-local-position-execution-disabled-v1";
  serviceFeeBps: 0;
  snapshotVersion: typeof P05_LOCAL_POSITION_SNAPSHOT_VERSION;
  tokenPolicy: {
    allowedFixturesOnly: true;
    executionUnknownToken: "deny";
    tokens: readonly {
      address: `0x${string}`;
      fixture: "TestOnlyERC20" | "TestOnlyWBNB";
      runtimeCodeHash: `0x${string}`;
    }[];
  };
  validFromBlock: "0";
  validToBlock: "1000000";
}

type RegistryPayload = Omit<LocalPositionExecutionRegistry, "registryDigest">;

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

export function localPositionExecutionRegistryDigest(
  registry: RegistryPayload | LocalPositionExecutionRegistry,
): `sha256:${string}` {
  const value = sha256(stringToHex(JSON.stringify(canonical(registry))));
  return `sha256:${value.slice(2)}`;
}

const registryPayload: RegistryPayload = {
  chainId: 31_337,
  environment: "non-forked-anvil-synthetic-only",
  executionEnabled: true,
  gates: Object.freeze({
    bsc: Object.freeze({ broadcasts: false, signatures: false, status: "CLOSED" }),
    local: Object.freeze({ broadcasts: true, signatures: true, status: "OPEN" }),
    production: Object.freeze({ broadcasts: false, signatures: false, status: "CLOSED" }),
    testnet: Object.freeze({ broadcasts: false, signatures: false, status: "CLOSED" }),
  }),
  manager: Object.freeze({
    abiHash: "sha256:3cba6ecedf67ddeeaca5efadd427bd749c462ce94ea7bb93ae161f9d52682cb9",
    address: "0xa513e6e4b8f2a923d98304ec87f64353c4d5c853",
    runtimeCodeHash: "0x6218a887ec7babb0af09bf8e4c71880954fcfeb5872b055e2f858f146bb25106",
    selectors: Object.freeze({
      burn: "0x42966c68",
      collect: "0xfc6f7865",
      decreaseLiquidity: "0x0c49ccbe",
    }),
  }),
  maxBlockDrift: 5,
  maxDeadlineSeconds: 900,
  maxSlippageBps: 500,
  platforms: Object.freeze([
    Object.freeze({ generation: "v3", platformId: 1 }),
    Object.freeze({ generation: "v3", platformId: 2 }),
    Object.freeze({ generation: "v4", platformId: 4 }),
    Object.freeze({ generation: "v4", platformId: 5 }),
  ]),
  planVersion: P05_LOCAL_POSITION_PLAN_VERSION,
  productionInheritance: false,
  registryVersion: P05_LOCAL_POSITION_EXECUTION_REGISTRY_VERSION,
  rollbackVersion: "p05-local-position-execution-disabled-v1",
  serviceFeeBps: 0,
  snapshotVersion: P05_LOCAL_POSITION_SNAPSHOT_VERSION,
  tokenPolicy: Object.freeze({
    allowedFixturesOnly: true,
    executionUnknownToken: "deny",
    tokens: Object.freeze(
      P05_HELPER_DEPLOYMENT_REGISTRY.tokens.map(({ address, fixture, runtimeCodeHash }) =>
        Object.freeze({ address, fixture, runtimeCodeHash }),
      ),
    ),
  }),
  validFromBlock: "0",
  validToBlock: "1000000",
};

export const P05_LOCAL_POSITION_EXECUTION_REGISTRY: LocalPositionExecutionRegistry = Object.freeze({
  ...registryPayload,
  registryDigest: localPositionExecutionRegistryDigest(registryPayload),
});

export function validateLocalPositionExecutionRegistry(
  registry: LocalPositionExecutionRegistry = P05_LOCAL_POSITION_EXECUTION_REGISTRY,
): LocalPositionExecutionRegistry {
  const expectedPlatforms = "1:v3,2:v3,4:v4,5:v4";
  const expectedTokens = P05_HELPER_DEPLOYMENT_REGISTRY.tokens;
  if (
    registry.chainId !== 31_337 ||
    registry.registryVersion !== P05_LOCAL_POSITION_EXECUTION_REGISTRY_VERSION ||
    registry.snapshotVersion !== P05_LOCAL_POSITION_SNAPSHOT_VERSION ||
    registry.planVersion !== P05_LOCAL_POSITION_PLAN_VERSION ||
    registry.environment !== "non-forked-anvil-synthetic-only" ||
    !registry.executionEnabled ||
    registry.productionInheritance ||
    registry.serviceFeeBps !== 0 ||
    registry.manager.address !== "0xa513e6e4b8f2a923d98304ec87f64353c4d5c853" ||
    registry.manager.abiHash !==
      "sha256:3cba6ecedf67ddeeaca5efadd427bd749c462ce94ea7bb93ae161f9d52682cb9" ||
    registry.manager.runtimeCodeHash !==
      "0x6218a887ec7babb0af09bf8e4c71880954fcfeb5872b055e2f858f146bb25106" ||
    registry.manager.selectors.collect !== "0xfc6f7865" ||
    registry.manager.selectors.decreaseLiquidity !== "0x0c49ccbe" ||
    registry.manager.selectors.burn !== "0x42966c68" ||
    registry.platforms
      .map(({ generation, platformId }) => `${platformId}:${generation}`)
      .join(",") !== expectedPlatforms ||
    registry.tokenPolicy.tokens.length !== 2 ||
    registry.tokenPolicy.tokens.some(
      (token, index) =>
        token.address !== expectedTokens[index]?.address ||
        token.fixture !== expectedTokens[index]?.fixture ||
        token.runtimeCodeHash !== expectedTokens[index]?.runtimeCodeHash,
    ) ||
    registry.gates.local.status !== "OPEN" ||
    !registry.gates.local.signatures ||
    !registry.gates.local.broadcasts ||
    (["bsc", "testnet", "production"] as const).some(
      (environment) =>
        registry.gates[environment].status !== "CLOSED" ||
        registry.gates[environment].signatures ||
        registry.gates[environment].broadcasts,
    ) ||
    registry.registryDigest !== localPositionExecutionRegistryDigest(registry)
  ) {
    throw new RangeError("LOCAL_POSITION_EXECUTION_REGISTRY_INVALID");
  }
  return registry;
}

validateLocalPositionExecutionRegistry();
