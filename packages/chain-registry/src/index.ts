import { getAddress, keccak256, type Hex } from "viem";

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
  if (!addressPattern.test(identity.address) || identity.address !== identity.address.toLowerCase()) {
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
      throw new Error(`POSITION_READ_REGISTRY_INVALID: generation ${String(deployment.platformId)}`);
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
