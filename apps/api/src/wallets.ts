import type {
  CustodyWallet,
  CustodyWalletPage,
  GenerateCustodyWalletRequest,
  WalletDeletePreview,
  WalletEncryptionMode,
} from "@lpbot/api-contract";
import type { StoredSession } from "@lpbot/security";

export const walletSecretMediaType = "application/vnd.lpbot.wallet-secret+json";
export const keystoreSecretMediaType = "application/vnd.lpbot.keystore-secret+json";
export const walletSecretBodyLimit = 16_384;
export const keystoreSecretBodyLimit = 16_384;

export interface KeystoreStatusDto {
  configured: boolean;
  status: "locked" | "locked-out" | "unconfigured" | "unlocked";
  version: number;
}

export interface KeystoreResetPreviewDto {
  confirmationPhrase: "I_LOSE_ALL_PASSWORD_WALLETS";
  expiresAt: string;
  policyCount: number;
  previewToken: string;
  secretVersion: number;
  strategyCount: number;
  taskCount: number;
  walletCount: number;
  walletsWithNonzeroAssets: number;
  walletsWithPositions: number;
}

export interface KeystoreApplication {
  changeKeystorePassword(input: {
    ingress: Uint8Array;
    userId: string;
  }): Promise<KeystoreStatusDto>;
  changeWalletEncryptionMode(input: {
    ingress: Uint8Array;
    tenantId: string;
    userId: string;
    walletId: string;
  }): Promise<CustodyWallet>;
  createKeystorePassword(input: {
    ingress: Uint8Array;
    userId: string;
  }): Promise<KeystoreStatusDto>;
  createKeystoreResetPreview(userId: string): Promise<KeystoreResetPreviewDto>;
  keystoreStatus(userId: string, reauthenticatedSessionId?: string): Promise<KeystoreStatusDto>;
  lockKeystore(userId: string): Promise<KeystoreStatusDto>;
  resetKeystore(input: { ingress: Uint8Array; userId: string }): Promise<KeystoreStatusDto>;
  unlockKeystore(input: {
    ingress: Uint8Array;
    reauthenticatedSessionId: string;
    userId: string;
  }): Promise<KeystoreStatusDto>;
  updateKeystoreAutoLock(input: {
    expectedVersion: number;
    minutes: number;
    reauthenticatedSessionId: string;
    userId: string;
  }): Promise<KeystoreStatusDto>;
}

export interface WalletDirectory {
  createWalletDeletePreview?(userId: string, walletId: string): Promise<WalletDeletePreview>;
  getWallet(userId: string, walletId: string): Promise<CustodyWallet | null>;
  listWallets(userId: string): Promise<CustodyWalletPage>;
  renameWallet?(input: {
    expectedRevision: number;
    name: string;
    updatedAt: Date;
    userId: string;
    walletId: string;
  }): Promise<CustodyWallet>;
}

export interface WalletSignerClient {
  generateWallet(input: {
    ingress?: Uint8Array;
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

export interface FreshReauthenticationVerifier {
  verify(input: {
    proof: string | null;
    requestId: string;
    session: StoredSession;
  }): Promise<boolean>;
}

export type WalletApiErrorCode =
  | "INVALID_MODE"
  | "INVALID_AUTO_LOCK"
  | "INVALID_CREDENTIALS"
  | "INVALID_PRIVATE_KEY"
  | "INVALID_QUERY"
  | "INVALID_WALLET"
  | "REAUTH_REQUIRED"
  | "REVISION_CONFLICT"
  | "REQUEST_TOO_LARGE"
  | "SIGNER_UNAVAILABLE"
  | "SECRET_VERSION_CONFLICT"
  | "LOCKED_OUT"
  | "PASSWORD_ALREADY_CONFIGURED"
  | "PASSWORD_POLICY_FAILED"
  | "PREVIEW_CHANGED"
  | "PREVIEW_EXPIRED"
  | "CONFIRMATION_MISMATCH"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "WALLET_ADDRESS_EXISTS"
  | "WALLET_NOT_FOUND";

export class WalletApiError extends Error {
  readonly code: WalletApiErrorCode;

  constructor(code: WalletApiErrorCode) {
    super(code);
    this.name = "WalletApiError";
    this.code = code;
  }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const addressPattern = /^0x[0-9a-fA-F]{40}$/u;

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new WalletApiError("INVALID_WALLET");
  }
  return value as Record<string, unknown>;
}

export function parseGenerateCustodyWalletRequest(value: unknown): GenerateCustodyWalletRequest {
  const input = record(value);
  if (Object.keys(input).some((key) => key !== "mode" && key !== "name")) {
    throw new WalletApiError("INVALID_WALLET");
  }
  if (input.mode !== "server-kek" && input.mode !== "user-password") {
    throw new WalletApiError("INVALID_MODE");
  }
  if (
    typeof input.name !== "string" ||
    [...input.name].length < 1 ||
    [...input.name].length > 80 ||
    input.name.trim() !== input.name ||
    /\p{Cc}/u.test(input.name)
  ) {
    throw new WalletApiError("INVALID_WALLET");
  }
  return { mode: input.mode, name: input.name };
}

export function parseRenameCustodyWalletRequest(value: unknown): {
  expectedRevision: number;
  name: string;
} {
  const input = record(value);
  if (Object.keys(input).sort().join(",") !== "expectedRevision,name") {
    throw new WalletApiError("INVALID_WALLET");
  }
  if (!Number.isSafeInteger(input.expectedRevision) || Number(input.expectedRevision) < 1) {
    throw new WalletApiError("REVISION_CONFLICT");
  }
  if (
    typeof input.name !== "string" ||
    [...input.name].length < 1 ||
    [...input.name].length > 80 ||
    input.name.trim() !== input.name ||
    /\p{Cc}/u.test(input.name)
  ) {
    throw new WalletApiError("INVALID_WALLET");
  }
  return { expectedRevision: Number(input.expectedRevision), name: input.name };
}

export function parseWalletId(value: unknown): string {
  if (typeof value !== "string" || !uuidPattern.test(value)) {
    throw new WalletApiError("WALLET_NOT_FOUND");
  }
  return value.toLowerCase();
}

export function publicWalletDto(value: unknown): CustodyWallet {
  const wallet = record(value);
  if (
    typeof wallet.walletId !== "string" ||
    !uuidPattern.test(wallet.walletId) ||
    typeof wallet.name !== "string" ||
    [...wallet.name].length < 1 ||
    [...wallet.name].length > 80 ||
    typeof wallet.address !== "string" ||
    !addressPattern.test(wallet.address) ||
    (wallet.mode !== "server-kek" && wallet.mode !== "user-password") ||
    (wallet.lockStatus !== "ready" &&
      wallet.lockStatus !== "locked" &&
      wallet.lockStatus !== "quarantined") ||
    !Number.isSafeInteger(wallet.envelopeVersion) ||
    Number(wallet.envelopeVersion) < 1 ||
    !Number.isSafeInteger(wallet.revision) ||
    Number(wallet.revision) < 1 ||
    typeof wallet.createdAt !== "string" ||
    new Date(wallet.createdAt).toISOString() !== wallet.createdAt ||
    typeof wallet.updatedAt !== "string" ||
    new Date(wallet.updatedAt).toISOString() !== wallet.updatedAt
  ) {
    throw new WalletApiError("SIGNER_UNAVAILABLE");
  }
  return {
    address: wallet.address as `0x${string}`,
    createdAt: wallet.createdAt,
    envelopeVersion: Number(wallet.envelopeVersion),
    lockStatus: wallet.lockStatus,
    mode: wallet.mode,
    name: wallet.name,
    revision: Number(wallet.revision),
    updatedAt: wallet.updatedAt,
    walletId: wallet.walletId.toLowerCase(),
  };
}

function stringList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) => typeof item === "string" && item.length > 0 && item.length <= 256 && !/\p{Cc}/u.test(item),
    ) &&
    new Set(value).size === value.length
  );
}

export function publicWalletDeletePreview(value: unknown): WalletDeletePreview {
  const preview = record(value);
  const dependencies = record(preview.dependencies);
  const expectedKeys = [
    "assetCount",
    "assetRiskDigest",
    "confirmationPhrase",
    "dependencies",
    "expiresAt",
    "forceEligible",
    "policyCount",
    "positionCount",
    "previewToken",
    "revision",
    "taskCount",
    "walletId",
  ].sort();
  if (
    Object.keys(preview).sort().join(",") !== expectedKeys.join(",") ||
    Object.keys(dependencies).sort().join(",") !==
      ["assetIds", "policyIds", "positionIds", "taskIds"].sort().join(",") ||
    !stringList(dependencies.assetIds) ||
    !stringList(dependencies.policyIds) ||
    !stringList(dependencies.positionIds) ||
    !stringList(dependencies.taskIds) ||
    preview.assetCount !== dependencies.assetIds.length ||
    preview.policyCount !== dependencies.policyIds.length ||
    preview.positionCount !== dependencies.positionIds.length ||
    preview.taskCount !== dependencies.taskIds.length ||
    typeof preview.assetRiskDigest !== "string" ||
    preview.assetRiskDigest.length < 1 ||
    preview.assetRiskDigest.length > 256 ||
    typeof preview.confirmationPhrase !== "string" ||
    !/^DELETE WALLET [A-F0-9]{8}$/u.test(preview.confirmationPhrase) ||
    typeof preview.previewToken !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/u.test(preview.previewToken) ||
    typeof preview.walletId !== "string" ||
    !uuidPattern.test(preview.walletId) ||
    !Number.isSafeInteger(preview.revision) ||
    Number(preview.revision) < 1 ||
    typeof preview.forceEligible !== "boolean" ||
    typeof preview.expiresAt !== "string" ||
    new Date(preview.expiresAt).toISOString() !== preview.expiresAt
  ) {
    throw new WalletApiError("SIGNER_UNAVAILABLE");
  }
  return preview as unknown as WalletDeletePreview;
}

export function publicKeystoreStatus(value: unknown): KeystoreStatusDto {
  const status = record(value);
  const keys = Object.keys(status).sort();
  if (
    keys.join(",") !== "configured,status,version" ||
    typeof status.configured !== "boolean" ||
    !Number.isSafeInteger(status.version) ||
    Number(status.version) < 0 ||
    (status.status !== "unconfigured" &&
      status.status !== "locked" &&
      status.status !== "unlocked" &&
      status.status !== "locked-out") ||
    (status.configured === false && (status.version !== 0 || status.status !== "unconfigured")) ||
    (status.configured === true && Number(status.version) < 1)
  ) {
    throw new WalletApiError("SIGNER_UNAVAILABLE");
  }
  return status as unknown as KeystoreStatusDto;
}

export function publicKeystoreResetPreview(value: unknown): KeystoreResetPreviewDto {
  const preview = record(value);
  const keys = [
    "confirmationPhrase",
    "expiresAt",
    "policyCount",
    "previewToken",
    "secretVersion",
    "strategyCount",
    "taskCount",
    "walletCount",
    "walletsWithNonzeroAssets",
    "walletsWithPositions",
  ].sort();
  if (
    Object.keys(preview).sort().join(",") !== keys.join(",") ||
    preview.confirmationPhrase !== "I_LOSE_ALL_PASSWORD_WALLETS" ||
    typeof preview.previewToken !== "string" ||
    preview.previewToken.length < 32 ||
    typeof preview.expiresAt !== "string" ||
    new Date(preview.expiresAt).toISOString() !== preview.expiresAt ||
    ![
      "policyCount",
      "strategyCount",
      "taskCount",
      "walletCount",
      "walletsWithNonzeroAssets",
      "walletsWithPositions",
    ].every((key) => Number.isSafeInteger(preview[key]) && Number(preview[key]) >= 0) ||
    !Number.isSafeInteger(preview.secretVersion) ||
    Number(preview.secretVersion) < 1
  ) {
    throw new WalletApiError("SIGNER_UNAVAILABLE");
  }
  return preview as unknown as KeystoreResetPreviewDto;
}
