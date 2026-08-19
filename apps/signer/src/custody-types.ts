import type {
  CustodyWallet,
  CustodyWalletPage,
  DeleteCustodyWalletRequest,
  SecurityPasswordStatus,
  WalletEncryptionMode,
  WalletDeletePreview,
  WalletDeletionReceipt,
  WalletDeletionType,
  WalletLockStatus,
} from "@lpbot/api-contract";
import type { WalletTransferPlan } from "@lpbot/domain/wallet-transfer";
import type { HelperDeploymentPlan } from "@lpbot/domain/helper-deployment";
import type {
  LocalSwapExecutionPlan,
  LocalSwapPermit2SigningPayload,
} from "@lpbot/domain/local-swap-execution";

export type CustodyAuditAction = "wallet.generate" | "wallet.import";

export interface CustodyEnvelope {
  aadVersion: 1;
  algorithm: "AES-256-GCM";
  ciphertext: Buffer;
  createdAt: Date;
  dekWrapNonce?: Buffer | null;
  dekWrapTag?: Buffer | null;
  dekWrapVersion?: 1;
  envelopeVersion: number;
  kekId: string;
  kekVersion: string;
  nonce: Buffer;
  secretVersion?: number | null;
  tag: Buffer;
  wrappedDek: Buffer;
}

export interface StoredCustodyWallet {
  address: `0x${string}`;
  addressLower: `0x${string}`;
  createdAt: Date;
  envelopeVersion: number;
  lockStatus: WalletLockStatus;
  mode: WalletEncryptionMode;
  name: string;
  revision: number;
  tenantId: string;
  updatedAt: Date;
  userId: string;
  walletId: string;
}

export interface CustodyWalletCreate {
  auditAction: CustodyAuditAction;
  envelope: CustodyEnvelope;
  wallet: StoredCustodyWallet;
}

export interface CustodyWalletStore {
  create(input: CustodyWalletCreate): Promise<CustodyWallet>;
  createWalletDeletePreview(preview: StoredWalletDeletePreview): Promise<void>;
  deleteWallet(input: WalletDeleteCommit): Promise<WalletDeletionReceipt>;
  get(userId: string, walletId: string): Promise<StoredCustodyWallet | null>;
  getCurrentEnvelope(walletId: string, envelopeVersion: number): Promise<CustodyEnvelope | null>;
  getWalletDeletePreview(
    userId: string,
    walletId: string,
    previewTokenDigest: Uint8Array,
  ): Promise<StoredWalletDeletePreview | null>;
  list(userId: string): Promise<CustodyWalletPage>;
  rename(input: {
    expectedRevision: number;
    name: string;
    updatedAt: Date;
    userId: string;
    walletId: string;
  }): Promise<CustodyWallet>;
  setLockStatus(
    userId: string,
    walletId: string,
    status: WalletLockStatus,
    updatedAt: Date,
  ): Promise<void>;
}

export interface WalletTransferPlanAuthorizer {
  authorize(input: {
    plan: WalletTransferPlan;
    planDigest: `sha256:${string}`;
    tenantId: string;
    userId: string;
  }): Promise<boolean>;
}

export interface HelperDeploymentPlanAuthorizer {
  authorize(input: {
    plan: HelperDeploymentPlan;
    planDigest: `sha256:${string}`;
    tenantId: string;
    userId: string;
  }): Promise<boolean>;
}

export interface LocalSwapStepPlanAuthorizer {
  authorize(input: {
    generation: number;
    maxFeePerGasBaseUnit: string;
    maxPriorityFeePerGasBaseUnit: string;
    plan: LocalSwapExecutionPlan;
    planDigest: `sha256:${string}`;
    stepId: string;
    tenantId: string;
    userId: string;
  }): Promise<boolean>;
}

export interface LocalSwapPermit2Authorizer {
  authorize(input: {
    payload: LocalSwapPermit2SigningPayload;
    tenantId: string;
    userId: string;
  }): Promise<boolean>;
}

export interface RawTransactionDeliveryResult {
  deliveryId: string;
  status: "accepted" | "already-known";
}

export interface RawTransactionDelivery {
  deliver(input: {
    chainId: number;
    operationId: string;
    rawTransaction: Uint8Array;
    transactionHash: `0x${string}`;
  }): Promise<RawTransactionDeliveryResult>;
}

export interface WalletTransferSigningResult extends RawTransactionDeliveryResult {
  planDigest: `sha256:${string}`;
  transactionHash: `0x${string}`;
}

export interface HelperDeploymentSigningResult extends RawTransactionDeliveryResult {
  planDigest: `sha256:${string}`;
  transactionHash: `0x${string}`;
}

export interface LocalSwapStepSigningResult extends RawTransactionDeliveryResult {
  generation: number;
  planDigest: `sha256:${string}`;
  stepId: string;
  transactionHash: `0x${string}`;
}

export interface LocalSwapPermit2SigningResult {
  authorizationDigest: `0x${string}`;
  signature: `0x${string}`;
}

export interface WalletDependencySnapshot {
  assetIds: string[];
  assetRiskDigest: string;
  complete: boolean;
  policyIds: string[];
  positionIds: string[];
  taskIds: string[];
}

export interface WalletDependencyInventory {
  inspect(input: { userId: string; walletId: string }): Promise<WalletDependencySnapshot>;
}

export interface WalletTaskDeactivation {
  restore(): Promise<void>;
}

export interface WalletTaskCoordinator {
  deactivate(input: {
    taskIds: readonly string[];
    userId: string;
    walletId: string;
  }): Promise<WalletTaskDeactivation>;
}

export interface StoredWalletDeletePreview extends WalletDependencySnapshot {
  confirmationPhrase: string;
  expiresAt: Date;
  forceEligible: boolean;
  previewTokenDigest: Buffer;
  revision: number;
  userId: string;
  walletId: string;
}

export interface WalletDeleteCommit extends WalletDependencySnapshot {
  deletionType: WalletDeletionType;
  expectedRevision: number;
  now: Date;
  previewTokenDigest: Buffer;
  userId: string;
  walletId: string;
}

export interface StoredSecurityPasswordVersion {
  createdAt: Date;
  parameterVersion: 1;
  salt: Buffer;
  verifier: Buffer;
  version: number;
}

export interface StoredSecurityPassword {
  current: StoredSecurityPasswordVersion;
  failureCount: number;
  lockedUntil: Date | null;
  updatedAt: Date;
  userId: string;
}

export interface SecurityPasswordStore {
  clearSecurityPasswordFailures(input: {
    now: Date;
    userId: string;
    version: number;
  }): Promise<void>;
  createSecurityPassword(password: StoredSecurityPassword): Promise<void>;
  getSecurityPassword(userId: string): Promise<StoredSecurityPassword | null>;
  recordSecurityPasswordFailure(input: {
    maxAttempts: number;
    now: Date;
    userId: string;
    version: number;
  }): Promise<StoredSecurityPassword>;
  rotateSecurityPassword(input: {
    expectedVersion: number;
    next: StoredSecurityPassword;
  }): Promise<void>;
}

export interface SecurityPasswordApplication {
  putSecurityPassword(input: {
    ingress: Uint8Array;
    userId: string;
  }): Promise<SecurityPasswordStatus>;
  securityPasswordStatus(userId: string): Promise<SecurityPasswordStatus>;
  verifySecurityPassword(input: {
    ingress: Uint8Array;
    userId: string;
  }): Promise<{ verified: true; version: number }>;
}

export type KeystoreState = "locked" | "locked-out" | "unconfigured" | "unlocked";

export interface KeystoreStatus {
  configured: boolean;
  status: KeystoreState;
  version: number;
}

export interface StoredKeystoreVersion {
  createdAt: Date;
  parameterVersion: 1;
  salt: Buffer;
  secretVersion: number;
  verifier: Buffer;
}

export interface StoredKeystore {
  autoLockMinutes: 1 | 5 | 15 | 30 | 60;
  current: StoredKeystoreVersion;
  updatedAt: Date;
  userId: string;
}

export interface StoredKeystoreFailure {
  backoffUntil: Date;
  failureCount: number;
  lockedUntil: Date | null;
  windowStartedAt: Date;
}

export interface StoredKeystoreResetPreview {
  contentDigest: string;
  expiresAt: Date;
  previewTokenDigest: Buffer;
  secretVersion: number;
  userId: string;
}

export interface KeystoreStore {
  clearKeystoreFailures(userId: string, sourceSessionId: string): Promise<void>;
  createKeystore(keystore: StoredKeystore): Promise<void>;
  getKeystore(userId: string): Promise<StoredKeystore | null>;
  getKeystoreFailure(
    userId: string,
    sourceSessionId: string,
  ): Promise<StoredKeystoreFailure | null>;
  recordKeystoreFailure(input: {
    backoffMilliseconds: number;
    maxAttempts: number;
    now: Date;
    sourceSessionId: string;
    userId: string;
    windowMilliseconds: number;
  }): Promise<StoredKeystoreFailure>;
  rotateKeystore(input: {
    expectedVersion: number;
    next: StoredKeystore;
    replacements?: WalletEnvelopeReplacement[];
  }): Promise<void>;
  setUserPasswordWalletLockStatus(
    userId: string,
    status: WalletLockStatus,
    updatedAt: Date,
  ): Promise<void>;
  updateKeystoreAutoLock(input: {
    expectedVersion: number;
    minutes: 1 | 5 | 15 | 30 | 60;
    updatedAt: Date;
    userId: string;
  }): Promise<void>;
  listUserPasswordWalletMaterials(userId: string): Promise<WalletEnvelopeMaterial[]>;
  switchWalletEncryptionMode(input: {
    envelope: CustodyEnvelope;
    expectedRevision: number;
    expectedSecretVersion: number;
    lockStatus: WalletLockStatus;
    mode: WalletEncryptionMode;
    updatedAt: Date;
    userId: string;
    walletId: string;
  }): Promise<CustodyWallet>;
  createKeystoreResetPreview(preview: StoredKeystoreResetPreview): Promise<void>;
  getKeystoreResetPreview(
    userId: string,
    previewTokenDigest: Uint8Array,
  ): Promise<StoredKeystoreResetPreview | null>;
  resetKeystore(input: {
    expectedVersion: number;
    now: Date;
    previewTokenDigest: Uint8Array;
    userId: string;
  }): Promise<void>;
}

export interface WalletEnvelopeMaterial {
  envelope: CustodyEnvelope;
  wallet: StoredCustodyWallet;
}

export interface WalletEnvelopeReplacement extends WalletEnvelopeMaterial {
  expectedEnvelopeVersion: number;
  expectedRevision: number;
}

export interface WalletDirectory {
  createWalletDeletePreview(userId: string, walletId: string): Promise<WalletDeletePreview>;
  deleteWallet(
    input: DeleteCustodyWalletRequest & { userId: string; walletId: string },
  ): Promise<WalletDeletionReceipt>;
  getWallet(userId: string, walletId: string): Promise<CustodyWallet | null>;
  listWallets(userId: string): Promise<CustodyWalletPage>;
  renameWallet(input: {
    expectedRevision: number;
    name: string;
    updatedAt: Date;
    userId: string;
    walletId: string;
  }): Promise<CustodyWallet>;
}

export interface WalletSignerClient {
  generateWallet(input: {
    mode: WalletEncryptionMode;
    name: string;
    tenantId: string;
    userId: string;
  }): Promise<CustodyWallet>;
  importWallet(input: {
    ingress: Uint8Array;
    tenantId: string;
    userId: string;
  }): Promise<CustodyWallet>;
}

export function publicWallet(wallet: StoredCustodyWallet): CustodyWallet {
  return {
    address: wallet.address,
    createdAt: wallet.createdAt.toISOString(),
    envelopeVersion: wallet.envelopeVersion,
    lockStatus: wallet.lockStatus,
    mode: wallet.mode,
    name: wallet.name,
    revision: wallet.revision,
    updatedAt: wallet.updatedAt.toISOString(),
    walletId: wallet.walletId,
  };
}
