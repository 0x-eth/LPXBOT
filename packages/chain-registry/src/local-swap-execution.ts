import { sha256, stringToHex } from "viem";

import {
  P05_HELPER_DEPLOYMENT_REGISTRY,
  WALLET_HELPER_V1_VERSION,
} from "./helper-deployment.js";

export const P05_LOCAL_SWAP_EXECUTION_REGISTRY_VERSION =
  "p05-local-swap-execution-v2" as const;
export const P05_LOCAL_SWAP_QUOTE_VERSION = "p05-local-swap-quote-v2" as const;

export type LocalSwapEnvironment = "local" | "testnet" | "production";
export type LocalSwapComponentRole = "adapter" | "permit2" | "router";

export interface LocalSwapCodeIdentity {
  address: `0x${string}`;
  role: LocalSwapComponentRole;
  runtimeCodeHash: `0x${string}`;
}

export interface LocalSwapTokenIdentity {
  address: `0x${string}`;
  fixture: "TestOnlyERC20" | "TestOnlyWBNB";
  runtimeCodeHash: `0x${string}`;
}

export interface LocalSwapExecutionRegistry {
  chainId: 31_337;
  components: readonly [LocalSwapCodeIdentity, LocalSwapCodeIdentity, LocalSwapCodeIdentity];
  environment: "non-forked-anvil-synthetic-only";
  executionEnabled: true;
  gates: Readonly<
    Record<LocalSwapEnvironment, { broadcasts: boolean; signatures: boolean; status: "CLOSED" | "OPEN" }>
  >;
  helper: {
    executeSwapSelector: "0x5a547e89";
    helperVersion: typeof WALLET_HELPER_V1_VERSION;
    instanceBinding: "chainId+walletId+helperVersion";
    runtimeTemplateHash: `0x${string}`;
  };
  maxAmountBaseUnit: "340282366920938463463374607431768211455";
  maxBlockDrift: 5;
  maxPermit2ExpirationSeconds: 1_800;
  maxQuoteAgeSeconds: 30;
  productionInheritance: false;
  quoteVersion: typeof P05_LOCAL_SWAP_QUOTE_VERSION;
  registryDigest: `sha256:${string}`;
  registryVersion: typeof P05_LOCAL_SWAP_EXECUTION_REGISTRY_VERSION;
  rollbackVersion: "p05-local-swap-execution-disabled-v1";
  routerSelector: "0xbb05e388";
  serviceFeeBps: 0;
  tokens: readonly [LocalSwapTokenIdentity, LocalSwapTokenIdentity];
  validFromBlock: "0";
  validToBlock: "1000000";
}

type RegistryPayload = Omit<LocalSwapExecutionRegistry, "registryDigest">;

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

export function localSwapExecutionRegistryDigest(
  registry: RegistryPayload | LocalSwapExecutionRegistry,
): `sha256:${string}` {
  const digest = sha256(stringToHex(JSON.stringify(canonical(registry))));
  return `sha256:${digest.slice(2)}`;
}

const helperRegistry = P05_HELPER_DEPLOYMENT_REGISTRY;
const legacyComponents = {
  adapter: {
    address: "0x5fc8d32690cc91d4c39d9d3abcbd16989f875707",
    role: "adapter",
    runtimeCodeHash: "0xb4b2ae4ee6025275948cb04c4ab0ad52cf5e6bb016def1a2050568b812bb30f8",
  },
  permit2: {
    address: "0x9fe46736679d2d9a65f0992f2272de9f3c7fa6e0",
    role: "permit2",
    runtimeCodeHash: "0x85f295c14e6e29cd939674c5f0ec10bc1606a00330ffd059e604bd231e35b7ad",
  },
  router: {
    address: "0xcf7ed3acca5a467e9e704c703e8d87f634fb0fc9",
    role: "router",
    runtimeCodeHash: "0x3c6483edb8b5d43ef28f4cbc66c181a3b3dcb40a445cfd80af52f8590a419216",
  },
} as const satisfies Record<LocalSwapComponentRole, LocalSwapCodeIdentity>;

const registryPayload: RegistryPayload = {
  chainId: 31_337,
  components: Object.freeze([
    Object.freeze(legacyComponents.adapter),
    Object.freeze(legacyComponents.permit2),
    Object.freeze(legacyComponents.router),
  ]),
  environment: "non-forked-anvil-synthetic-only",
  executionEnabled: true,
  gates: Object.freeze({
    local: Object.freeze({ broadcasts: true, signatures: true, status: "OPEN" }),
    production: Object.freeze({ broadcasts: false, signatures: false, status: "CLOSED" }),
    testnet: Object.freeze({ broadcasts: false, signatures: false, status: "CLOSED" }),
  }),
  helper: Object.freeze({
    executeSwapSelector: "0x5a547e89",
    helperVersion: WALLET_HELPER_V1_VERSION,
    instanceBinding: "chainId+walletId+helperVersion",
    runtimeTemplateHash: helperRegistry.helperTemplate.runtimeTemplateHash,
  }),
  maxAmountBaseUnit: "340282366920938463463374607431768211455",
  maxBlockDrift: 5,
  maxPermit2ExpirationSeconds: 1_800,
  maxQuoteAgeSeconds: 30,
  productionInheritance: false,
  quoteVersion: P05_LOCAL_SWAP_QUOTE_VERSION,
  registryVersion: P05_LOCAL_SWAP_EXECUTION_REGISTRY_VERSION,
  rollbackVersion: "p05-local-swap-execution-disabled-v1",
  routerSelector: "0xbb05e388",
  serviceFeeBps: 0,
  tokens: Object.freeze([
    Object.freeze({ ...helperRegistry.tokens[0] }),
    Object.freeze({ ...helperRegistry.tokens[1] }),
  ]),
  validFromBlock: "0",
  validToBlock: "1000000",
};

export const P05_LOCAL_SWAP_EXECUTION_REGISTRY: LocalSwapExecutionRegistry = Object.freeze({
  ...registryPayload,
  registryDigest: localSwapExecutionRegistryDigest(registryPayload),
});

export function localSwapComponent(
  role: LocalSwapComponentRole,
  registry: LocalSwapExecutionRegistry = P05_LOCAL_SWAP_EXECUTION_REGISTRY,
): LocalSwapCodeIdentity {
  const component = registry.components.find((candidate) => candidate.role === role);
  if (!component) throw new RangeError(`LOCAL_SWAP_COMPONENT_MISSING:${role}`);
  return component;
}

export function validateLocalSwapExecutionRegistry(
  registry: LocalSwapExecutionRegistry = P05_LOCAL_SWAP_EXECUTION_REGISTRY,
): LocalSwapExecutionRegistry {
  if (
    registry.chainId !== 31_337 ||
    registry.registryVersion !== P05_LOCAL_SWAP_EXECUTION_REGISTRY_VERSION ||
    registry.quoteVersion !== P05_LOCAL_SWAP_QUOTE_VERSION ||
    registry.environment !== "non-forked-anvil-synthetic-only" ||
    registry.productionInheritance ||
    !registry.executionEnabled ||
    registry.serviceFeeBps !== 0 ||
    registry.gates.local.status !== "OPEN" ||
    !registry.gates.local.signatures ||
    !registry.gates.local.broadcasts ||
    registry.gates.testnet.status !== "CLOSED" ||
    registry.gates.testnet.signatures ||
    registry.gates.testnet.broadcasts ||
    registry.gates.production.status !== "CLOSED" ||
    registry.gates.production.signatures ||
    registry.gates.production.broadcasts ||
    registry.components.length !== 3 ||
    registry.tokens.length !== 2 ||
    registry.registryDigest !== localSwapExecutionRegistryDigest(registry)
  ) {
    throw new RangeError("LOCAL_SWAP_EXECUTION_REGISTRY_INVALID");
  }
  for (const role of ["adapter", "permit2", "router"] as const) localSwapComponent(role, registry);
  if (
    new Set(registry.tokens.map(({ address }) => address)).size !== 2 ||
    registry.tokens.some(
      (token) =>
        !helperRegistry.tokens.some(
          (expected) =>
            expected.address === token.address &&
            expected.fixture === token.fixture &&
            expected.runtimeCodeHash === token.runtimeCodeHash,
        ),
    )
  ) {
    throw new RangeError("LOCAL_SWAP_EXECUTION_REGISTRY_INVALID");
  }
  return registry;
}

validateLocalSwapExecutionRegistry();
