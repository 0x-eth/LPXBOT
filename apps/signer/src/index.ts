import { observabilityPackage } from "@lpbot/observability";
import { securityPackage } from "@lpbot/security";

export { CustodySignerService } from "./custody-signer-service.js";
export type {
  CustodyEnvelope,
  CustodyWalletCreate,
  CustodyWalletStore,
  RawTransactionDelivery,
  RawTransactionDeliveryResult,
  HelperDeploymentPlanAuthorizer,
  HelperDeploymentSigningResult,
  LocalSwapPermit2Authorizer,
  LocalSwapPermit2SigningResult,
  LocalSwapStepPlanAuthorizer,
  LocalSwapStepSigningResult,
  KeystoreStatus,
  KeystoreStore,
  SecurityPasswordApplication,
  SecurityPasswordStore,
  StoredKeystore,
  StoredKeystoreFailure,
  StoredKeystoreResetPreview,
  StoredKeystoreVersion,
  StoredSecurityPassword,
  StoredSecurityPasswordVersion,
  StoredWalletDeletePreview,
  WalletDeleteCommit,
  StoredCustodyWallet,
  WalletEnvelopeMaterial,
  WalletEnvelopeReplacement,
  WalletDependencyInventory,
  WalletDependencySnapshot,
  WalletDirectory,
  WalletSignerClient,
  WalletTaskCoordinator,
  WalletTaskDeactivation,
  WalletTransferPlanAuthorizer,
  WalletTransferSigningResult,
} from "./custody-types.js";
export { signerCapabilities, IsolatedWalletSigner } from "./isolated-wallet-signer.js";
export type { KmsClient, KmsKeyDescriptor, WrappedDek } from "./kms.js";
export { LocalKmsFixture } from "./kms.js";
export { InMemoryCustodyWalletStore } from "./memory-custody-wallet-store.js";
export { PostgresCustodyWalletStore } from "./postgres-custody-wallet-store.js";
export { PostgresWalletTransferPlanAuthorizer } from "./postgres-transfer-plan-authorizer.js";
export {
  PostgresHelperDeploymentPlanAuthorizer,
  ViemLocalHelperDeploymentPlanVerifier,
} from "./postgres-helper-deployment-plan-authorizer.js";
export type {
  HelperDeploymentPlanChainVerification,
  HelperDeploymentPlanChainVerifier,
  ViemLocalHelperDeploymentPlanVerifierOptions,
} from "./postgres-helper-deployment-plan-authorizer.js";
export { ResilientRawTransactionDelivery } from "./resilient-raw-transaction-delivery.js";
export type { RawTransactionBroadcastPort } from "./resilient-raw-transaction-delivery.js";
export {
  buildPasswordDekWrapAad,
  createPasswordVerifier,
  deriveArgon2idKek,
  openPasswordDekWrap,
  passwordKdfV1,
  sealPasswordDekWrap,
} from "./password-crypto.js";
export type { PasswordDekWrap, PasswordKdfParameters } from "./password-crypto.js";
export {
  createSecurityPasswordVerifier,
  deriveSecurityPasswordKey,
  securityPasswordKdfV1,
} from "./security-password-crypto.js";
export { SignerError } from "./signer-error.js";
export { SignerConfigurationError, loadSignerProductionConfig } from "./production-config.js";

export const signerApp = {
  capabilities: ["import", "generate", "seal", "open-verify"],
  name: "@lpbot/signer",
  observability: observabilityPackage.name,
  security: securityPackage.name,
} as const;
