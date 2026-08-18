import type {
  CustodyWallet,
  CustodyWalletPage,
  GenerateCustodyWalletRequest,
  WalletEncryptionMode,
} from "@lpbot/api-contract";
import type { StoredSession } from "@lpbot/security";

export const walletSecretMediaType = "application/vnd.lpbot.wallet-secret+json";
export const walletSecretBodyLimit = 16_384;

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

export interface FreshReauthenticationVerifier {
  verify(input: { proof: string | null; requestId: string; session: StoredSession }): Promise<boolean>;
}

export type WalletApiErrorCode =
  | "INVALID_MODE"
  | "INVALID_PRIVATE_KEY"
  | "INVALID_QUERY"
  | "INVALID_WALLET"
  | "REAUTH_REQUIRED"
  | "REQUEST_TOO_LARGE"
  | "SIGNER_UNAVAILABLE"
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
  if (input.mode !== "server-kek") throw new WalletApiError("INVALID_MODE");
  if (
    typeof input.name !== "string" ||
    input.name.length < 1 ||
    input.name.length > 80 ||
    input.name.trim() !== input.name ||
    /\p{Cc}/u.test(input.name)
  ) {
    throw new WalletApiError("INVALID_WALLET");
  }
  return { mode: input.mode, name: input.name };
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
    wallet.name.length < 1 ||
    wallet.name.length > 80 ||
    typeof wallet.address !== "string" ||
    !addressPattern.test(wallet.address) ||
    wallet.mode !== "server-kek" ||
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
