import type {
  CustodyWallet,
  CustodyWalletPage,
  WalletEncryptionMode,
  WalletLockStatus,
} from "@lpbot/api-contract";

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
  get(userId: string, walletId: string): Promise<StoredCustodyWallet | null>;
  getCurrentEnvelope(walletId: string, envelopeVersion: number): Promise<CustodyEnvelope | null>;
  list(userId: string): Promise<CustodyWalletPage>;
  setLockStatus(
    userId: string,
    walletId: string,
    status: WalletLockStatus,
    updatedAt: Date,
  ): Promise<void>;
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
  getWallet(userId: string, walletId: string): Promise<CustodyWallet | null>;
  listWallets(userId: string): Promise<CustodyWalletPage>;
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
