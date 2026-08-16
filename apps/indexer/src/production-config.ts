import {
  ProductionBscEventDecoder,
  SUPPORTED_EVENT_TOPICS,
  createViemBscLogSourceFromEnv,
  type ViemBscLogSource,
} from "@lpbot/chain-adapters";
import {
  findRegisteredChain,
  validateProtocolDeploymentRegistry,
  verifyProtocolDeploymentCode,
  type ProtocolDeployment,
  type ProtocolDeploymentVerification,
} from "@lpbot/chain-registry";

export interface ProductionIndexerConfig {
  chainId: 56;
  deployments: readonly ProtocolDeployment[];
  fromBlock: string;
  maxAttempts?: number;
  maxBlockSpan?: number;
  maxPagesPerRead?: number;
  retryBaseMilliseconds?: number;
  timeoutMilliseconds?: number;
}

export interface InitializedProductionIndexerAdapters {
  chainAccessConfigurationComplete: boolean;
  decoder: ProductionBscEventDecoder;
  deploymentVerification: ProtocolDeploymentVerification;
  marketDecoderComplete: boolean;
  source: ViemBscLogSource;
}

function containsFixtureSelector(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsFixtureSelector);
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    Object.hasOwn(record, "decoderFixtureId") || Object.values(record).some(containsFixtureSelector)
  );
}

export function validateProductionIndexerConfig(value: unknown): ProductionIndexerConfig {
  if (containsFixtureSelector(value)) {
    throw new Error("FIXTURE_DECODER_FORBIDDEN: decoderFixtureId is tests-only");
  }
  if (typeof value !== "object" || value === null) {
    throw new Error("PRODUCTION_DECODER_CONFIG_MISSING: configuration is required");
  }
  const config = value as Partial<ProductionIndexerConfig>;
  if (
    config.chainId !== 56 ||
    !Array.isArray(config.deployments) ||
    config.deployments.length === 0 ||
    typeof config.fromBlock !== "string" ||
    !/^(?:0|[1-9][0-9]*)$/u.test(config.fromBlock)
  ) {
    throw new Error(
      "PRODUCTION_DECODER_CONFIG_MISSING: versioned deployments and decimal fromBlock are required",
    );
  }
  try {
    validateProtocolDeploymentRegistry(config.deployments);
  } catch {
    throw new Error("PRODUCTION_DECODER_CONFIG_MISSING: deployment registry is invalid");
  }
  return config as ProductionIndexerConfig;
}

export async function initializeProductionIndexerAdapters(
  input: unknown,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<InitializedProductionIndexerAdapters> {
  const config = validateProductionIndexerConfig(input);
  const source = createViemBscLogSourceFromEnv(
    {
      fromBlock: config.fromBlock,
      ...(config.maxAttempts === undefined ? {} : { maxAttempts: config.maxAttempts }),
      ...(config.maxBlockSpan === undefined ? {} : { maxBlockSpan: config.maxBlockSpan }),
      ...(config.maxPagesPerRead === undefined
        ? {}
        : { maxPagesPerRead: config.maxPagesPerRead }),
      ...(config.retryBaseMilliseconds === undefined
        ? {}
        : { retryBaseMilliseconds: config.retryBaseMilliseconds }),
      ...(config.timeoutMilliseconds === undefined
        ? {}
        : { timeoutMilliseconds: config.timeoutMilliseconds }),
      topics: [...new Set(SUPPORTED_EVENT_TOPICS)],
    },
    environment,
  );
  const deploymentVerification = await verifyProtocolDeploymentCode({
    chainId: config.chainId,
    deployments: config.deployments,
    getCode: (address, blockNumber) => source.getCode(address, blockNumber),
  });
  const decoder = new ProductionBscEventDecoder({
    deployments: deploymentVerification.enabled,
  });
  const chainAccessConfigurationComplete =
    findRegisteredChain(config.chainId)?.configurationComplete ?? false;
  const marketDecoderComplete =
    deploymentVerification.enabled.length === 4 && deploymentVerification.failures.length === 0;
  return {
    chainAccessConfigurationComplete,
    decoder,
    deploymentVerification,
    marketDecoderComplete,
    source,
  };
}
