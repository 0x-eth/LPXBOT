import { getAddress, keccak256, type Hex } from "viem";

export {
  LocalExecutionRegistryError,
  P05_BSC_LOCAL_EXECUTION_REGISTRY,
  P05_BSC_LOCAL_EXECUTION_REGISTRY_VERSION,
  P05_LOCAL_FEE_POLICY_VERSION,
  P05_LOCAL_TOKEN_POLICY_VERSION,
  validateLocalExecutionRegistryContext,
} from "./local-execution.js";
export type {
  LocalExecutionCodeIdentity,
  LocalExecutionComponentRole,
  LocalExecutionFeePolicy,
  LocalExecutionRegistry,
  LocalExecutionRegistryFailure,
  LocalExecutionTokenIdentity,
  LocalExecutionTokenPolicy,
  LocalExecutionVerification,
  LocalTokenBehavior,
} from "./local-execution.js";
export {
  buildWalletHelperV1DeploymentMaterial,
  helperDeploymentComponent,
  helperDeploymentRegistryDigest,
  P05_HELPER_DEPLOYMENT_PLAN_VERSION,
  P05_HELPER_DEPLOYMENT_REGISTRY,
  P05_HELPER_DEPLOYMENT_REGISTRY_VERSION,
  validateHelperDeploymentRegistry,
  WALLET_HELPER_V1_VERSION,
} from "./helper-deployment.js";
export {
  localSwapComponent,
  localSwapExecutionRegistryDigest,
  P05_LOCAL_SWAP_EXECUTION_REGISTRY,
  P05_LOCAL_SWAP_EXECUTION_REGISTRY_VERSION,
  P05_LOCAL_SWAP_QUOTE_VERSION,
  validateLocalSwapExecutionRegistry,
} from "./local-swap-execution.js";
export type {
  LocalSwapCodeIdentity,
  LocalSwapComponentRole,
  LocalSwapEnvironment,
  LocalSwapExecutionRegistry,
  LocalSwapTokenIdentity,
} from "./local-swap-execution.js";
export {
  localPositionExecutionRegistryDigest,
  P05_LOCAL_POSITION_EXECUTION_REGISTRY,
  P05_LOCAL_POSITION_EXECUTION_REGISTRY_VERSION,
  P05_LOCAL_POSITION_PLAN_VERSION,
  P05_LOCAL_POSITION_SNAPSHOT_VERSION,
  validateLocalPositionExecutionRegistry,
} from "./local-position-execution.js";
export type {
  LocalPositionEnvironment,
  LocalPositionExecutionRegistry,
  LocalPositionPlatformId,
} from "./local-position-execution.js";
export type {
  HelperBytecodeTemplate,
  HelperDeploymentComponent,
  HelperDeploymentRegistry,
  HelperDeploymentToken,
} from "./helper-deployment.js";

export const chainRegistryPackage = {
  name: "@lpbot/chain-registry",
} as const;

export interface RegisteredChain {
  chainId: number;
  configurationComplete: boolean;
  displayName: string;
  isDefault: boolean;
  missingConfiguration: readonly string[];
}

export const chainRegistry = [
  {
    chainId: 56,
    configurationComplete: true,
    displayName: "BNB Smart Chain",
    isDefault: true,
    missingConfiguration: [],
  },
  {
    chainId: 8453,
    configurationComplete: true,
    displayName: "Base",
    isDefault: false,
    missingConfiguration: [],
  },
  {
    chainId: 1,
    configurationComplete: true,
    displayName: "Ethereum",
    isDefault: false,
    missingConfiguration: [],
  },
  {
    chainId: 4663,
    configurationComplete: false,
    displayName: "Robinhood Chain",
    isDefault: false,
    missingConfiguration: ["execution-adapter"],
  },
  {
    chainId: 196,
    configurationComplete: false,
    displayName: "X Layer",
    isDefault: false,
    missingConfiguration: ["execution-adapter"],
  },
] as const satisfies readonly RegisteredChain[];

export function findRegisteredChain(chainId: number): RegisteredChain | null {
  return chainRegistry.find((chain) => chain.chainId === chainId) ?? null;
}

export type ProtocolId = 1 | 2 | 4 | 5;
export type ProtocolPlatformId = "univ3" | "pcsv3" | "univ4" | "pcsv4";
export type ProtocolGeneration = "v3" | "v4";

export const P05_BSC_EXECUTION_REGISTRY_VERSION = "p05-bsc-execution-v1" as const;

export interface BscReadContractIdentity {
  address: `0x${string}`;
  runtimeCodeHash: Hex;
}

export interface BscPositionReadDeployment {
  abiHash: `sha256:${string}`;
  chainId: 56;
  factory: BscReadContractIdentity | null;
  generation: ProtocolGeneration;
  platformId: ProtocolId;
  platformKey: ProtocolPlatformId;
  poolIdentity: "poolAddress" | "poolId";
  poolManager: BscReadContractIdentity | null;
  positionManager: BscReadContractIdentity;
  registryVersion: typeof P05_BSC_EXECUTION_REGISTRY_VERSION;
  stateView: BscReadContractIdentity | null;
  validFromBlock: string;
  validToBlock: string | null;
}

export interface BscPositionReadRegistry {
  chainId: 56;
  deployments: readonly BscPositionReadDeployment[];
  effectiveBlock: string;
  executionEnabled: false;
  registryVersion: typeof P05_BSC_EXECUTION_REGISTRY_VERSION;
  supportedChainIds: readonly [56];
}

export interface BscSwapQuoteRoute {
  chainId: 56;
  platformId: ProtocolId;
  registryVersion: typeof P05_BSC_EXECUTION_REGISTRY_VERSION;
  router: BscReadContractIdentity;
  selector: `0x${string}`;
  spender: `0x${string}`;
}

export interface BscSwapQuoteToken {
  address: `0x${string}`;
  chainId: 56;
  decimals: number;
  symbol: string;
}

export interface BscSwapQuoteRegistry {
  chainId: 56;
  executionEnabled: false;
  executionRouterSelectorAllowlist: readonly [];
  registryVersion: typeof P05_BSC_EXECUTION_REGISTRY_VERSION;
  routes: readonly BscSwapQuoteRoute[];
  supportedChainIds: readonly [56];
  tokens: readonly BscSwapQuoteToken[];
}

const bscSwapQuoteRoutes = [
  {
    chainId: 56,
    platformId: 1,
    registryVersion: P05_BSC_EXECUTION_REGISTRY_VERSION,
    router: {
      address: "0x1111111111111111111111111111111111110051",
      runtimeCodeHash: "0x5151515151515151515151515151515151515151515151515151515151515151",
    },
    selector: "0x01000051",
    spender: "0x1111111111111111111111111111111111110151",
  },
  {
    chainId: 56,
    platformId: 2,
    registryVersion: P05_BSC_EXECUTION_REGISTRY_VERSION,
    router: {
      address: "0x2222222222222222222222222222222222220052",
      runtimeCodeHash: "0x5252525252525252525252525252525252525252525252525252525252525252",
    },
    selector: "0x02000052",
    spender: "0x2222222222222222222222222222222222220152",
  },
  {
    chainId: 56,
    platformId: 4,
    registryVersion: P05_BSC_EXECUTION_REGISTRY_VERSION,
    router: {
      address: "0x4444444444444444444444444444444444440054",
      runtimeCodeHash: "0x5454545454545454545454545454545454545454545454545454545454545454",
    },
    selector: "0x04000054",
    spender: "0x4444444444444444444444444444444444440154",
  },
  {
    chainId: 56,
    platformId: 5,
    registryVersion: P05_BSC_EXECUTION_REGISTRY_VERSION,
    router: {
      address: "0x5555555555555555555555555555555555550055",
      runtimeCodeHash: "0x5555555555555555555555555555555555555555555555555555555555555555",
    },
    selector: "0x05000055",
    spender: "0x5555555555555555555555555555555555550155",
  },
] as const satisfies readonly BscSwapQuoteRoute[];

export const BSC_SWAP_QUOTE_REGISTRY: BscSwapQuoteRegistry = Object.freeze({
  chainId: 56,
  executionEnabled: false,
  executionRouterSelectorAllowlist: Object.freeze([] as const),
  registryVersion: P05_BSC_EXECUTION_REGISTRY_VERSION,
  routes: Object.freeze(
    bscSwapQuoteRoutes.map((route) =>
      Object.freeze({ ...route, router: Object.freeze({ ...route.router }) }),
    ),
  ),
  supportedChainIds: Object.freeze([56] as const),
  tokens: Object.freeze([
    Object.freeze({
      address: "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
      chainId: 56 as const,
      decimals: 18,
      symbol: "WBNB",
    }),
    Object.freeze({
      address: "0x55d398326f99059ff775485246999027b3197955",
      chainId: 56 as const,
      decimals: 18,
      symbol: "USDT",
    }),
    Object.freeze({
      address: "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",
      chainId: 56 as const,
      decimals: 18,
      symbol: "USDC",
    }),
  ]),
});

export interface ProtocolDeployment {
  abiHash: `sha256:${string}`;
  chainId: 56;
  deploymentVersion: string;
  evidenceRefs: readonly string[];
  factory: `0x${string}` | null;
  generation: ProtocolGeneration;
  platformId: ProtocolPlatformId;
  poolManager: `0x${string}` | null;
  protocolId: ProtocolId;
  runtimeCodeHash: Hex;
  schemaVersion: 1;
  validFromBlock: string;
  validToBlock: string | null;
}

const protocolIdentity = {
  1: { generation: "v3", platformId: "univ3" },
  2: { generation: "v3", platformId: "pcsv3" },
  4: { generation: "v4", platformId: "univ4" },
  5: { generation: "v4", platformId: "pcsv4" },
} as const satisfies Record<
  ProtocolId,
  { generation: ProtocolGeneration; platformId: ProtocolPlatformId }
>;

export const BSC_PROTOCOL_DEPLOYMENTS = [
  {
    abiHash: "sha256:462410c6e3d0ed2537e30a6da51006ca5154cbd2e3f43331bb792134590488b8",
    chainId: 56,
    deploymentVersion: "1.0.0",
    evidenceRefs: ["SRC-UNIV3-ABI", "SRC-UNIV3-BSC-DEPLOYMENT", "CHAIN-UNIV3-FACTORY"],
    factory: "0xdb1d10011ad0ff90774d0c6bb92e5c5c8b4461f7",
    generation: "v3",
    platformId: "univ3",
    poolManager: null,
    protocolId: 1,
    runtimeCodeHash: "0x34b1009d0f004e58da791225992645e2df7697ac71ac89dc5e80469c4ef7e322",
    schemaVersion: 1,
    validFromBlock: "26324014",
    validToBlock: null,
  },
  {
    abiHash: "sha256:3a010d793511297a187cf8bac7e1eeba8e4b1a1c3a800ce12f8b657d28a3db66",
    chainId: 56,
    deploymentVersion: "1.0.0",
    evidenceRefs: ["SRC-PCSV3-ABI", "SRC-PCSV3-BSC-DEPLOYMENT", "CHAIN-PCSV3-FACTORY"],
    factory: "0x0bfbcf9fa4f9c56b0f40a671ad40e0805a091865",
    generation: "v3",
    platformId: "pcsv3",
    poolManager: null,
    protocolId: 2,
    runtimeCodeHash: "0x8191d3ab1d55d3da9822199f28865415c99566b6f1aee4a4b16713f57930678c",
    schemaVersion: 1,
    validFromBlock: "26956207",
    validToBlock: null,
  },
  {
    abiHash: "sha256:2bc13431c8b4ae1430e4fd9fd7458db2b997bcfa5041fded4c0d2332cff1802e",
    chainId: 56,
    deploymentVersion: "1.0.0",
    evidenceRefs: ["SRC-UNIV4-ABI", "SRC-UNIV4-BSC-DEPLOYMENT", "CHAIN-UNIV4-POOL-MANAGER"],
    factory: null,
    generation: "v4",
    platformId: "univ4",
    poolManager: "0x28e2ea090877bf75740558f6bfb36a5ffee9e9df",
    protocolId: 4,
    runtimeCodeHash: "0x48752321ee7abf0d2a17c30679df9a1ddd14dc75d28b26e2509b76396145a005",
    schemaVersion: 1,
    validFromBlock: "45970610",
    validToBlock: null,
  },
  {
    abiHash: "sha256:cc9f30f76eebd726c3795966ecd6e5f044aee707b285287130cadb994b44ec9c",
    chainId: 56,
    deploymentVersion: "1.0.0",
    evidenceRefs: ["SRC-PCSV4-ABI", "SRC-PCSV4-BSC-DEPLOYMENT", "CHAIN-PCSV4-POOL-MANAGER"],
    factory: null,
    generation: "v4",
    platformId: "pcsv4",
    poolManager: "0xa0ffb9c1ce1fe56963b0321b32e7a0302114058b",
    protocolId: 5,
    runtimeCodeHash: "0x3caf72836cb6603c6af03bba1578ec70ece8c3e5b1d0ef73667b5fbd74b02a0f",
    schemaVersion: 1,
    validFromBlock: "47214308",
    validToBlock: null,
  },
] as const satisfies readonly ProtocolDeployment[];

const bscPositionReadDeployments = [
  {
    abiHash: "sha256:462410c6e3d0ed2537e30a6da51006ca5154cbd2e3f43331bb792134590488b8",
    chainId: 56,
    factory: {
      address: "0xdb1d10011ad0ff90774d0c6bb92e5c5c8b4461f7",
      runtimeCodeHash: "0x34b1009d0f004e58da791225992645e2df7697ac71ac89dc5e80469c4ef7e322",
    },
    generation: "v3",
    platformId: 1,
    platformKey: "univ3",
    poolIdentity: "poolAddress",
    poolManager: null,
    positionManager: {
      address: "0x7b8a01b39d58278b5de7e48c8449c9f4f5170613",
      runtimeCodeHash: "0xbc0177f23ffd65c41e41fb201e170cb253489d7d637f8f6a15743a1f861160f5",
    },
    registryVersion: P05_BSC_EXECUTION_REGISTRY_VERSION,
    stateView: null,
    validFromBlock: "116718413",
    validToBlock: null,
  },
  {
    abiHash: "sha256:3a010d793511297a187cf8bac7e1eeba8e4b1a1c3a800ce12f8b657d28a3db66",
    chainId: 56,
    factory: {
      address: "0x0bfbcf9fa4f9c56b0f40a671ad40e0805a091865",
      runtimeCodeHash: "0x8191d3ab1d55d3da9822199f28865415c99566b6f1aee4a4b16713f57930678c",
    },
    generation: "v3",
    platformId: 2,
    platformKey: "pcsv3",
    poolIdentity: "poolAddress",
    poolManager: null,
    positionManager: {
      address: "0x46a15b0b27311cedf172ab29e4f4766fbe7f4364",
      runtimeCodeHash: "0xf64dd82357e77afddcd6dd56f4ba161f44fe90a6f72da5433f8fc6901440197f",
    },
    registryVersion: P05_BSC_EXECUTION_REGISTRY_VERSION,
    stateView: null,
    validFromBlock: "116718413",
    validToBlock: null,
  },
  {
    abiHash: "sha256:2bc13431c8b4ae1430e4fd9fd7458db2b997bcfa5041fded4c0d2332cff1802e",
    chainId: 56,
    factory: null,
    generation: "v4",
    platformId: 4,
    platformKey: "univ4",
    poolIdentity: "poolId",
    poolManager: {
      address: "0x28e2ea090877bf75740558f6bfb36a5ffee9e9df",
      runtimeCodeHash: "0x48752321ee7abf0d2a17c30679df9a1ddd14dc75d28b26e2509b76396145a005",
    },
    positionManager: {
      address: "0x7a4a5c919ae2541aed11041a1aeee68f1287f95b",
      runtimeCodeHash: "0x07867576e9a6a0fdcead21a487dce04eae6161fb350edc8c56954c09fa015ef0",
    },
    registryVersion: P05_BSC_EXECUTION_REGISTRY_VERSION,
    stateView: null,
    validFromBlock: "116718413",
    validToBlock: null,
  },
  {
    abiHash: "sha256:cc9f30f76eebd726c3795966ecd6e5f044aee707b285287130cadb994b44ec9c",
    chainId: 56,
    factory: null,
    generation: "v4",
    platformId: 5,
    platformKey: "pcsv4",
    poolIdentity: "poolId",
    poolManager: {
      address: "0xa0ffb9c1ce1fe56963b0321b32e7a0302114058b",
      runtimeCodeHash: "0x3caf72836cb6603c6af03bba1578ec70ece8c3e5b1d0ef73667b5fbd74b02a0f",
    },
    positionManager: {
      address: "0x55f4c8aba71a1e923edc303eb4feff14608cc226",
      runtimeCodeHash: "0xe8fea1721cd1cb164280e02614b06d7d8033dcc81ed6fa97f5e7cc63341d34ed",
    },
    registryVersion: P05_BSC_EXECUTION_REGISTRY_VERSION,
    stateView: null,
    validFromBlock: "116718413",
    validToBlock: null,
  },
] as const satisfies readonly BscPositionReadDeployment[];

export const BSC_POSITION_READ_REGISTRY: BscPositionReadRegistry = Object.freeze({
  chainId: 56,
  deployments: Object.freeze(
    bscPositionReadDeployments.map((deployment) =>
      Object.freeze({
        ...deployment,
        factory: deployment.factory === null ? null : Object.freeze({ ...deployment.factory }),
        poolManager:
          deployment.poolManager === null ? null : Object.freeze({ ...deployment.poolManager }),
        positionManager: Object.freeze({ ...deployment.positionManager }),
        stateView: deployment.stateView,
      }),
    ),
  ),
  effectiveBlock: "116718413",
  executionEnabled: false,
  registryVersion: P05_BSC_EXECUTION_REGISTRY_VERSION,
  supportedChainIds: Object.freeze([56] as const),
});

const addressPattern = /^0x[0-9a-f]{40}$/u;
const codeHashPattern = /^0x[0-9a-f]{64}$/u;
const abiHashPattern = /^sha256:[0-9a-f]{64}$/u;
const decimalBlockPattern = /^(?:0|[1-9][0-9]*)$/u;
const semanticVersionPattern = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u;

const positionReadIdentity = {
  1: {
    abiHash: "sha256:462410c6e3d0ed2537e30a6da51006ca5154cbd2e3f43331bb792134590488b8",
    generation: "v3",
    platformKey: "univ3",
    poolIdentity: "poolAddress",
    positionManager: "0x7b8a01b39d58278b5de7e48c8449c9f4f5170613",
  },
  2: {
    abiHash: "sha256:3a010d793511297a187cf8bac7e1eeba8e4b1a1c3a800ce12f8b657d28a3db66",
    generation: "v3",
    platformKey: "pcsv3",
    poolIdentity: "poolAddress",
    positionManager: "0x46a15b0b27311cedf172ab29e4f4766fbe7f4364",
  },
  4: {
    abiHash: "sha256:2bc13431c8b4ae1430e4fd9fd7458db2b997bcfa5041fded4c0d2332cff1802e",
    generation: "v4",
    platformKey: "univ4",
    poolIdentity: "poolId",
    positionManager: "0x7a4a5c919ae2541aed11041a1aeee68f1287f95b",
  },
  5: {
    abiHash: "sha256:cc9f30f76eebd726c3795966ecd6e5f044aee707b285287130cadb994b44ec9c",
    generation: "v4",
    platformKey: "pcsv4",
    poolIdentity: "poolId",
    positionManager: "0x55f4c8aba71a1e923edc303eb4feff14608cc226",
  },
} as const satisfies Record<
  ProtocolId,
  {
    abiHash: `sha256:${string}`;
    generation: ProtocolGeneration;
    platformKey: ProtocolPlatformId;
    poolIdentity: "poolAddress" | "poolId";
    positionManager: `0x${string}`;
  }
>;

function validateReadContractIdentity(
  identity: BscReadContractIdentity | null,
  label: string,
): void {
  if (identity === null) return;
  if (
    !addressPattern.test(identity.address) ||
    identity.address !== identity.address.toLowerCase()
  ) {
    throw new Error(`POSITION_READ_REGISTRY_INVALID: ${label} address`);
  }
  if (!codeHashPattern.test(identity.runtimeCodeHash)) {
    throw new Error(`POSITION_READ_REGISTRY_INVALID: ${label} runtime code hash`);
  }
}

export function validateBscPositionReadRegistry<T extends BscPositionReadRegistry>(registry: T): T {
  if (
    registry.registryVersion !== P05_BSC_EXECUTION_REGISTRY_VERSION ||
    registry.chainId !== 56 ||
    registry.executionEnabled !== false ||
    registry.supportedChainIds.length !== 1 ||
    registry.supportedChainIds[0] !== 56 ||
    !decimalBlockPattern.test(registry.effectiveBlock)
  ) {
    throw new Error("POSITION_READ_REGISTRY_INVALID: registry identity");
  }
  const identities = new Set<string>();
  const positionManagers = new Set<string>();
  for (const deployment of registry.deployments) {
    const expected = positionReadIdentity[deployment.platformId];
    if (
      !expected ||
      deployment.chainId !== 56 ||
      deployment.registryVersion !== registry.registryVersion ||
      deployment.generation !== expected.generation ||
      deployment.platformKey !== expected.platformKey ||
      deployment.poolIdentity !== expected.poolIdentity ||
      deployment.abiHash !== expected.abiHash ||
      deployment.positionManager.address !== expected.positionManager
    ) {
      throw new Error(`POSITION_READ_REGISTRY_INVALID: platform ${String(deployment.platformId)}`);
    }
    const hasFactory = deployment.factory !== null;
    const hasPoolManager = deployment.poolManager !== null;
    if (hasFactory === hasPoolManager || hasFactory !== (deployment.generation === "v3")) {
      throw new Error(
        `POSITION_READ_REGISTRY_INVALID: generation ${String(deployment.platformId)}`,
      );
    }
    if (
      !abiHashPattern.test(deployment.abiHash) ||
      !decimalBlockPattern.test(deployment.validFromBlock) ||
      (deployment.validToBlock !== null &&
        (!decimalBlockPattern.test(deployment.validToBlock) ||
          BigInt(deployment.validToBlock) < BigInt(deployment.validFromBlock)))
    ) {
      throw new Error(`POSITION_READ_REGISTRY_INVALID: validity ${String(deployment.platformId)}`);
    }
    validateReadContractIdentity(deployment.factory, "factory");
    validateReadContractIdentity(deployment.poolManager, "pool manager");
    validateReadContractIdentity(deployment.positionManager, "position manager");
    validateReadContractIdentity(deployment.stateView, "state view");
    const identity = `${deployment.chainId}:${deployment.platformId}:${deployment.validFromBlock}:${deployment.validToBlock ?? "open"}`;
    if (identities.has(identity) || positionManagers.has(deployment.positionManager.address)) {
      throw new Error("POSITION_READ_REGISTRY_INVALID: duplicate deployment");
    }
    identities.add(identity);
    positionManagers.add(deployment.positionManager.address);
  }
  return registry;
}

export function getBscPositionReadDeployment(input: {
  blockNumber: string;
  chainId: number;
  platformId: number;
  registryVersion: string;
}): BscPositionReadDeployment | null {
  if (
    input.chainId !== 56 ||
    input.registryVersion !== BSC_POSITION_READ_REGISTRY.registryVersion ||
    !decimalBlockPattern.test(input.blockNumber)
  ) {
    return null;
  }
  const blockNumber = BigInt(input.blockNumber);
  return (
    BSC_POSITION_READ_REGISTRY.deployments.find(
      (deployment) =>
        deployment.platformId === input.platformId &&
        blockNumber >= BigInt(deployment.validFromBlock) &&
        (deployment.validToBlock === null || blockNumber <= BigInt(deployment.validToBlock)),
    ) ?? null
  );
}

export interface BscHelperReadVersion {
  chainId: 56;
  helperVersion: string;
  ownerSelector: `0x${string}`;
  registryVersion: typeof P05_BSC_EXECUTION_REGISTRY_VERSION;
  requiredSelectors: readonly `0x${string}`[];
  runtimeCodeHash: Hex;
}

export interface BscHelperReadRegistry {
  chainId: 56;
  currentVersion: string;
  executionEnabled: false;
  registryVersion: typeof P05_BSC_EXECUTION_REGISTRY_VERSION;
  versions: readonly BscHelperReadVersion[];
  versionsComparableAcrossChains: false;
}

export interface BscHelperResidualAllowlist {
  chainId: 56;
  coverageComplete: boolean;
  nftManagerAddresses: readonly `0x${string}`[];
  registryVersion: typeof P05_BSC_EXECUTION_REGISTRY_VERSION;
  spenderAddresses: readonly `0x${string}`[];
  tokenAddresses: readonly `0x${string}`[];
  version: string;
}

const observedHelperV1Selectors = Object.freeze([
  "0x8da5cb5b",
  "0xadc3f25c",
  "0xfb691fd9",
] as const);
const observedHelperV2Selectors = Object.freeze([
  "0x5dfd8e50",
  "0x71fa74ed",
  "0x8da5cb5b",
] as const);

export const BSC_HELPER_READ_REGISTRY = Object.freeze({
  chainId: 56,
  currentVersion: "observed-bsc-helper-v2",
  executionEnabled: false,
  registryVersion: P05_BSC_EXECUTION_REGISTRY_VERSION,
  versions: Object.freeze([
    Object.freeze({
      chainId: 56,
      helperVersion: "observed-bsc-helper-v1",
      ownerSelector: "0x8da5cb5b",
      registryVersion: P05_BSC_EXECUTION_REGISTRY_VERSION,
      requiredSelectors: observedHelperV1Selectors,
      runtimeCodeHash: "0x42795bc1467d4c1aad4704c13255eb646768885f22886c486430b30a93caebd7",
    }),
    Object.freeze({
      chainId: 56,
      helperVersion: "observed-bsc-helper-v2",
      ownerSelector: "0x8da5cb5b",
      registryVersion: P05_BSC_EXECUTION_REGISTRY_VERSION,
      requiredSelectors: observedHelperV2Selectors,
      runtimeCodeHash: "0xaf866c449723b487e87ce38974433ea413a2e7826226865c678665d84c86cd85",
    }),
  ]),
  versionsComparableAcrossChains: false,
} as const satisfies BscHelperReadRegistry);

export const BSC_HELPER_RESIDUAL_ALLOWLIST = Object.freeze({
  chainId: 56,
  coverageComplete: false,
  nftManagerAddresses: Object.freeze(
    BSC_POSITION_READ_REGISTRY.deployments
      .map(({ positionManager }) => positionManager.address)
      .sort((left, right) => left.localeCompare(right)),
  ),
  registryVersion: P05_BSC_EXECUTION_REGISTRY_VERSION,
  spenderAddresses: Object.freeze([
    "0x000000000022d473030f116ddee9f6b43ac78ba3",
    "0x2c34a2fb1d0b4f55de51e1d0bdefaddce6b7cdd6",
    "0x31c2f6fcff4f8759b3bd5bf0e1084a055615c768",
  ] as const),
  tokenAddresses: Object.freeze([
    "0x55d398326f99059ff775485246999027b3197955",
    "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
  ] as const),
  version: "p05-bsc-helper-residual-v1",
} as const satisfies BscHelperResidualAllowlist);

const selectorPattern = /^0x[0-9a-f]{8}$/u;
const helperVersionPattern = /^[a-z0-9](?:[a-z0-9.-]{0,62}[a-z0-9])?$/u;

export function validateBscHelperReadRegistry<T extends BscHelperReadRegistry>(registry: T): T {
  if (
    registry.chainId !== 56 ||
    registry.registryVersion !== P05_BSC_EXECUTION_REGISTRY_VERSION ||
    registry.executionEnabled !== false ||
    registry.versionsComparableAcrossChains !== false ||
    !helperVersionPattern.test(registry.currentVersion)
  ) {
    throw new Error("HELPER_READ_REGISTRY_INVALID: registry identity");
  }
  const versions = new Set<string>();
  for (const version of registry.versions) {
    if (
      version.chainId !== 56 ||
      version.registryVersion !== registry.registryVersion ||
      !helperVersionPattern.test(version.helperVersion) ||
      !codeHashPattern.test(version.runtimeCodeHash) ||
      !selectorPattern.test(version.ownerSelector) ||
      version.requiredSelectors.length === 0 ||
      !version.requiredSelectors.includes(version.ownerSelector) ||
      version.requiredSelectors.some((selector) => !selectorPattern.test(selector)) ||
      new Set(version.requiredSelectors).size !== version.requiredSelectors.length ||
      versions.has(version.helperVersion)
    ) {
      throw new Error(`HELPER_READ_REGISTRY_INVALID: version ${version.helperVersion}`);
    }
    versions.add(version.helperVersion);
  }
  if (!versions.has(registry.currentVersion)) {
    throw new Error("HELPER_READ_REGISTRY_INVALID: current version");
  }
  return registry;
}

export function getBscHelperReadVersion(helperVersion: string): BscHelperReadVersion | null {
  return (
    BSC_HELPER_READ_REGISTRY.versions.find(
      (candidate) => candidate.helperVersion === helperVersion,
    ) ?? null
  );
}

function deploymentAddress(deployment: ProtocolDeployment): `0x${string}` {
  const address = deployment.factory ?? deployment.poolManager;
  if (!address) throw new Error("PROTOCOL_DEPLOYMENT_INVALID: contract address is missing");
  return address;
}

function invalid(message: string): never {
  throw new Error(`PROTOCOL_DEPLOYMENT_INVALID: ${message}`);
}

export function validateProtocolDeploymentRegistry<T extends readonly ProtocolDeployment[]>(
  deployments: T,
): T {
  const ranges = new Map<string, { from: bigint; to: bigint | null }[]>();
  for (const deployment of deployments) {
    const expected = protocolIdentity[deployment.protocolId];
    if (
      deployment.schemaVersion !== 1 ||
      deployment.chainId !== 56 ||
      !expected ||
      expected.platformId !== deployment.platformId ||
      expected.generation !== deployment.generation
    ) {
      invalid(`identity mismatch for protocol ${String(deployment.protocolId)}`);
    }
    if (!semanticVersionPattern.test(deployment.deploymentVersion)) {
      invalid(`${deployment.platformId} deploymentVersion must be semantic versioning`);
    }
    const hasFactory = deployment.factory !== null;
    const hasPoolManager = deployment.poolManager !== null;
    if (hasFactory === hasPoolManager || hasFactory !== (deployment.generation === "v3")) {
      invalid(`${deployment.platformId} must declare exactly its generation contract kind`);
    }
    const contract = deploymentAddress(deployment);
    if (!addressPattern.test(contract) || contract !== contract.toLowerCase()) {
      invalid(`${deployment.platformId} address must be lowercase canonical hex`);
    }
    if (!decimalBlockPattern.test(deployment.validFromBlock)) {
      invalid(`${deployment.platformId} validFromBlock is malformed`);
    }
    if (
      deployment.validToBlock !== null &&
      (!decimalBlockPattern.test(deployment.validToBlock) ||
        BigInt(deployment.validToBlock) < BigInt(deployment.validFromBlock))
    ) {
      invalid(`${deployment.platformId} valid block range is inverted or malformed`);
    }
    if (!codeHashPattern.test(deployment.runtimeCodeHash)) {
      invalid(`${deployment.platformId} runtime code hash is malformed`);
    }
    if (!abiHashPattern.test(deployment.abiHash)) {
      invalid(`${deployment.platformId} ABI hash is malformed`);
    }
    if (
      deployment.evidenceRefs.length === 0 ||
      deployment.evidenceRefs.some((reference) => reference.trim().length === 0)
    ) {
      invalid(`${deployment.platformId} evidence references are missing`);
    }
    const rangeKey = `${deployment.chainId}:${deployment.platformId}`;
    const from = BigInt(deployment.validFromBlock);
    const to = deployment.validToBlock === null ? null : BigInt(deployment.validToBlock);
    const protocolRanges = ranges.get(rangeKey) ?? [];
    if (
      protocolRanges.some(
        (range) => (range.to === null || from <= range.to) && (to === null || range.from <= to),
      )
    ) {
      invalid(`overlapping deployment ranges for ${rangeKey}`);
    }
    protocolRanges.push({ from, to });
    ranges.set(rangeKey, protocolRanges);
  }
  return deployments;
}

export function displayProtocolAddress(deployment: ProtocolDeployment): `0x${string}` {
  return getAddress(deploymentAddress(deployment));
}

export type ProtocolDeploymentFailureReason =
  | "chain-id-mismatch"
  | "deployment-missing"
  | "runtime-code-empty"
  | "runtime-code-hash-mismatch"
  | "runtime-code-read-failed";

export interface ProtocolDeploymentFailure {
  platformId: ProtocolPlatformId;
  reason: ProtocolDeploymentFailureReason;
}

export interface VerifyProtocolDeploymentCodeOptions {
  chainId: number;
  deployments: readonly ProtocolDeployment[];
  getCode(address: `0x${string}`, blockNumber: "latest" | string): Promise<Hex>;
}

export interface ProtocolDeploymentVerification {
  enabled: ProtocolDeployment[];
  failures: ProtocolDeploymentFailure[];
}

export async function verifyProtocolDeploymentCode(
  options: VerifyProtocolDeploymentCodeOptions,
): Promise<ProtocolDeploymentVerification> {
  validateProtocolDeploymentRegistry(options.deployments);
  const enabled: ProtocolDeployment[] = [];
  const failures: ProtocolDeploymentFailure[] = [];
  for (const deployment of options.deployments) {
    if (deployment.chainId !== options.chainId) {
      failures.push({ platformId: deployment.platformId, reason: "chain-id-mismatch" });
      continue;
    }
    try {
      const code = await options.getCode(deploymentAddress(deployment), "latest");
      if (code === "0x") {
        failures.push({ platformId: deployment.platformId, reason: "runtime-code-empty" });
      } else if (keccak256(code).toLowerCase() !== deployment.runtimeCodeHash) {
        failures.push({
          platformId: deployment.platformId,
          reason: "runtime-code-hash-mismatch",
        });
      } else {
        enabled.push({ ...deployment });
      }
    } catch {
      failures.push({ platformId: deployment.platformId, reason: "runtime-code-read-failed" });
    }
  }
  return { enabled, failures };
}

validateProtocolDeploymentRegistry(BSC_PROTOCOL_DEPLOYMENTS);
validateBscPositionReadRegistry(BSC_POSITION_READ_REGISTRY);
validateBscHelperReadRegistry(BSC_HELPER_READ_REGISTRY);
