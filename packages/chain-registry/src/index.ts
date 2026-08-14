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
