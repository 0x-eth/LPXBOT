export interface ProductionProtocolDecoderConfig {
  abi: readonly unknown[];
  address: string | null;
  id: "pcsv3" | "univ3" | "pcsv4" | "univ4";
  topic0: string | null;
}

export interface ProductionIndexerConfig {
  chainId: number;
  protocols: readonly ProductionProtocolDecoderConfig[];
}

function containsFixtureSelector(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsFixtureSelector);
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    Object.hasOwn(record, "decoderFixtureId") || Object.values(record).some(containsFixtureSelector)
  );
}

function address(value: string | null): value is string {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/u.test(value);
}

function topic(value: string | null): value is string {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/u.test(value);
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
    !Array.isArray(config.protocols) ||
    config.protocols.length === 0 ||
    config.protocols.some(
      (protocol) =>
        !address(protocol.address) || !topic(protocol.topic0) || protocol.abi.length === 0,
    )
  ) {
    throw new Error(
      "PRODUCTION_DECODER_CONFIG_MISSING: verified ABI, topic, and protocol address are required",
    );
  }
  return config as ProductionIndexerConfig;
}
