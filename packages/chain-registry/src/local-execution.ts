export const P05_BSC_LOCAL_EXECUTION_REGISTRY_VERSION =
  "p05-bsc-local-execution-v1" as const;
export const P05_LOCAL_TOKEN_POLICY_VERSION = "p05-local-token-policy-v1" as const;
export const P05_LOCAL_FEE_POLICY_VERSION = "p05-local-fee-policy-v1" as const;

export type LocalExecutionComponentRole =
  | "adapter"
  | "helper"
  | "permit2"
  | "position-manager"
  | "router"
  | "spender";

export interface LocalExecutionCodeIdentity {
  abiHash: `sha256:${string}`;
  address: `0x${string}`;
  proxyImplementation: null;
  proxyImplementationRuntimeCodeHash: null;
  role: LocalExecutionComponentRole;
  runtimeCodeHash: `0x${string}`;
}

export type LocalTokenBehavior =
  | "callback-reentrant"
  | "false-return"
  | "fee-on-transfer"
  | "malformed-metadata"
  | "no-return"
  | "rebasing"
  | "standard"
  | "usdt-style-approve"
  | "wrapped-native";

export interface LocalExecutionTokenIdentity {
  address: `0x${string}`;
  behavior: LocalTokenBehavior;
  executionAllowed: true;
  fixture: "TestOnlyERC20" | "TestOnlyWBNB";
  implementationAddress: null;
  implementationRuntimeCodeHash: null;
  runtimeCodeHash: `0x${string}`;
  symbol: "FIX" | "WBNB";
}

export interface LocalExecutionTokenPolicy {
  allowanceMode: "exact-amount-only";
  allowedFixturesOnly: true;
  dustLimitBaseUnit: "1";
  executionUnknownToken: "deny";
  maxAmountBaseUnit: "340282366920938463463374607431768211455";
  permit2MaxExpirationSeconds: 1800;
  policyDigest: `sha256:${string}`;
  policyVersion: typeof P05_LOCAL_TOKEN_POLICY_VERSION;
  productionUnknownToken: "read-only";
  resetAllowanceToZero: true;
  tokens: readonly LocalExecutionTokenIdentity[];
}

export interface LocalExecutionFeePolicy {
  dexProtocolFee: "quoted-separately";
  gas: "quoted-separately";
  lpFee: "quoted-separately";
  nonZeroServiceFee: "deny";
  policyDigest: `sha256:${string}`;
  policyVersion: typeof P05_LOCAL_FEE_POLICY_VERSION;
  serviceFeeBasis: "none";
  serviceFeeBps: 0;
  serviceFeeMaxBps: 0;
  serviceFeeRecipientAllowlist: readonly [];
}

export interface LocalExecutionRegistry {
  chainId: 31_337;
  components: readonly LocalExecutionCodeIdentity[];
  environment: "foundry-anvil-only";
  executionEnabled: true;
  feePolicy: LocalExecutionFeePolicy;
  helperSelectorAllowlist: readonly `0x${string}`[];
  productionInheritance: false;
  registryDigest: `sha256:${string}`;
  registryVersion: typeof P05_BSC_LOCAL_EXECUTION_REGISTRY_VERSION;
  rollbackVersion: "p05-bsc-local-execution-disabled-v0";
  routerSelectorAllowlist: readonly `0x${string}`[];
  tokenPolicy: LocalExecutionTokenPolicy;
  validFromBlock: "0";
  validToBlock: "1000000";
}

const component = (
  role: LocalExecutionComponentRole,
  address: `0x${string}`,
): LocalExecutionCodeIdentity =>
  Object.freeze({
    abiHash: `sha256:${role === "spender" ? "f" : "0".repeat(64)}` as `sha256:${string}`,
    address,
    proxyImplementation: null,
    proxyImplementationRuntimeCodeHash: null,
    role,
    runtimeCodeHash: `0x${(role === "spender" ? "f" : "0").repeat(64)}` as `0x${string}`,
  });

// Addresses are the deterministic CREATE sequence of Anvil's first fixture account.
// Hashes are replaced by the P05-04 finalizer after a pinned Foundry build and deployment.
export const P05_BSC_LOCAL_EXECUTION_REGISTRY: LocalExecutionRegistry = Object.freeze({
  chainId: 31_337,
  components: Object.freeze([
    component("permit2", "0x9fe46736679d2d9a65f0992f2272de9f3c7fa6e0"),
    component("router", "0xcf7ed3acca5a467e9e704c703e8d87f634fb0fc9"),
    component("position-manager", "0xdc64a140aa3e981100a9beca4e685f962f0cf6c9"),
    component("adapter", "0x5fc8d32690cc91d4c39d9d3abcbd16989f875707"),
    component("spender", "0x5fc8d32690cc91d4c39d9d3abcbd16989f875707"),
    component("helper", "0x0165878a594ca255338adfa4d48449f69242eb8f"),
  ]),
  environment: "foundry-anvil-only",
  executionEnabled: true,
  feePolicy: Object.freeze({
    dexProtocolFee: "quoted-separately",
    gas: "quoted-separately",
    lpFee: "quoted-separately",
    nonZeroServiceFee: "deny",
    policyDigest: `sha256:${"0".repeat(64)}`,
    policyVersion: P05_LOCAL_FEE_POLICY_VERSION,
    serviceFeeBasis: "none",
    serviceFeeBps: 0,
    serviceFeeMaxBps: 0,
    serviceFeeRecipientAllowlist: Object.freeze([] as const),
  }),
  helperSelectorAllowlist: Object.freeze([
    "0x11111111",
    "0x22222222",
    "0x33333333",
    "0x44444444",
  ] as const),
  productionInheritance: false,
  registryDigest: `sha256:${"0".repeat(64)}`,
  registryVersion: P05_BSC_LOCAL_EXECUTION_REGISTRY_VERSION,
  rollbackVersion: "p05-bsc-local-execution-disabled-v0",
  routerSelectorAllowlist: Object.freeze(["0x55555555"] as const),
  tokenPolicy: Object.freeze({
    allowanceMode: "exact-amount-only",
    allowedFixturesOnly: true,
    dustLimitBaseUnit: "1",
    executionUnknownToken: "deny",
    maxAmountBaseUnit: "340282366920938463463374607431768211455",
    permit2MaxExpirationSeconds: 1800,
    policyDigest: `sha256:${"0".repeat(64)}`,
    policyVersion: P05_LOCAL_TOKEN_POLICY_VERSION,
    productionUnknownToken: "read-only",
    resetAllowanceToZero: true,
    tokens: Object.freeze([
      Object.freeze({
        address: "0x5fbdb2315678afecb367f032d93f642f64180aa3",
        behavior: "standard",
        executionAllowed: true,
        fixture: "TestOnlyERC20",
        implementationAddress: null,
        implementationRuntimeCodeHash: null,
        runtimeCodeHash: `0x${"0".repeat(64)}`,
        symbol: "FIX",
      }),
      Object.freeze({
        address: "0xe7f1725e7734ce288f8367e1bb143e90bb3f0512",
        behavior: "wrapped-native",
        executionAllowed: true,
        fixture: "TestOnlyWBNB",
        implementationAddress: null,
        implementationRuntimeCodeHash: null,
        runtimeCodeHash: `0x${"0".repeat(64)}`,
        symbol: "WBNB",
      }),
    ]),
  }),
  validFromBlock: "0",
  validToBlock: "1000000",
});

export type LocalExecutionRegistryFailure =
  | "ABI_HASH_MISMATCH"
  | "ADDRESS_MISMATCH"
  | "BLOCK_OUTSIDE_VALIDITY"
  | "CHAIN_ID_MISMATCH"
  | "COMPONENT_MISSING"
  | "IMPLEMENTATION_MISMATCH"
  | "REGISTRY_VERSION_MISMATCH"
  | "RUNTIME_CODE_HASH_MISMATCH"
  | "SELECTOR_NOT_ALLOWLISTED"
  | "TOKEN_NOT_ALLOWLISTED"
  | "TOKEN_RUNTIME_CODE_HASH_MISMATCH";

export class LocalExecutionRegistryError extends Error {
  constructor(readonly reason: LocalExecutionRegistryFailure) {
    super(`LOCAL_EXECUTION_REGISTRY_REJECTED: ${reason}`);
    this.name = "LocalExecutionRegistryError";
  }
}

export interface LocalExecutionVerification {
  blockNumber: string;
  chainId: number;
  components: readonly LocalExecutionCodeIdentity[];
  registryVersion: string;
  selector: `0x${string}`;
  selectorScope: "helper" | "router";
  tokens: readonly {
    address: `0x${string}`;
    implementationAddress: `0x${string}` | null;
    implementationRuntimeCodeHash: `0x${string}` | null;
    runtimeCodeHash: `0x${string}`;
  }[];
}

function reject(reason: LocalExecutionRegistryFailure): never {
  throw new LocalExecutionRegistryError(reason);
}

export function validateLocalExecutionRegistryContext(
  verification: LocalExecutionVerification,
  registry: LocalExecutionRegistry = P05_BSC_LOCAL_EXECUTION_REGISTRY,
): LocalExecutionRegistry {
  if (verification.chainId !== registry.chainId) reject("CHAIN_ID_MISMATCH");
  if (verification.registryVersion !== registry.registryVersion) {
    reject("REGISTRY_VERSION_MISMATCH");
  }
  if (!/^(?:0|[1-9][0-9]*)$/u.test(verification.blockNumber)) {
    reject("BLOCK_OUTSIDE_VALIDITY");
  }
  const blockNumber = BigInt(verification.blockNumber);
  if (
    blockNumber < BigInt(registry.validFromBlock) ||
    blockNumber > BigInt(registry.validToBlock)
  ) {
    reject("BLOCK_OUTSIDE_VALIDITY");
  }

  const allowedSelectors =
    verification.selectorScope === "helper"
      ? registry.helperSelectorAllowlist
      : registry.routerSelectorAllowlist;
  if (!allowedSelectors.includes(verification.selector)) reject("SELECTOR_NOT_ALLOWLISTED");

  for (const expected of registry.components) {
    const actual = verification.components.find(({ role }) => role === expected.role);
    if (!actual) reject("COMPONENT_MISSING");
    if (actual.address !== expected.address) reject("ADDRESS_MISMATCH");
    if (actual.abiHash !== expected.abiHash) reject("ABI_HASH_MISMATCH");
    if (actual.runtimeCodeHash !== expected.runtimeCodeHash) {
      reject("RUNTIME_CODE_HASH_MISMATCH");
    }
    if (
      actual.proxyImplementation !== expected.proxyImplementation ||
      actual.proxyImplementationRuntimeCodeHash !== expected.proxyImplementationRuntimeCodeHash
    ) {
      reject("IMPLEMENTATION_MISMATCH");
    }
  }

  for (const actual of verification.tokens) {
    const expected = registry.tokenPolicy.tokens.find(({ address }) => address === actual.address);
    if (!expected) reject("TOKEN_NOT_ALLOWLISTED");
    if (actual.runtimeCodeHash !== expected.runtimeCodeHash) {
      reject("TOKEN_RUNTIME_CODE_HASH_MISMATCH");
    }
    if (
      actual.implementationAddress !== expected.implementationAddress ||
      actual.implementationRuntimeCodeHash !== expected.implementationRuntimeCodeHash
    ) {
      reject("IMPLEMENTATION_MISMATCH");
    }
  }
  return registry;
}
