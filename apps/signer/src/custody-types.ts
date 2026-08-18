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
  envelopeVersion: number;
  kekId: string;
  kekVersion: string;
  nonce: Buffer;
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
