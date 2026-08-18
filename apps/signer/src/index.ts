import { observabilityPackage } from "@lpbot/observability";
import { securityPackage } from "@lpbot/security";

export { CustodySignerService } from "./custody-signer-service.js";
export type {
  CustodyEnvelope,
  CustodyWalletCreate,
  CustodyWalletStore,
  StoredCustodyWallet,
  WalletDirectory,
  WalletSignerClient,
} from "./custody-types.js";
export { signerCapabilities, IsolatedWalletSigner } from "./isolated-wallet-signer.js";
export type { KmsClient, KmsKeyDescriptor, WrappedDek } from "./kms.js";
export { LocalKmsFixture } from "./kms.js";
export { InMemoryCustodyWalletStore } from "./memory-custody-wallet-store.js";
export { PostgresCustodyWalletStore } from "./postgres-custody-wallet-store.js";
export { SignerError } from "./signer-error.js";
export { SignerConfigurationError, loadSignerProductionConfig } from "./production-config.js";

export const signerApp = {
  capabilities: ["import", "generate", "seal", "open-verify"],
  name: "@lpbot/signer",
  observability: observabilityPackage.name,
  security: securityPackage.name,
} as const;
