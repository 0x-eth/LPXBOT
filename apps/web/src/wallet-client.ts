import type {
  ChangeWalletEncryptionModeRequest,
  CustodyWallet,
  CustodyWalletPage,
  DeleteCustodyWalletRequest,
  RenameCustodyWalletRequest,
  WalletDeleteDependencies,
  WalletDeletePreview,
  WalletDeletionReceipt,
} from "@lpbot/api-contract";
import { keystoreSecretMediaType } from "@lpbot/api-contract";

type WalletFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface ErrorEnvelope {
  error?: { code?: unknown; retryable?: unknown };
}

export type ImportCustodyWalletRequest =
  | { mode: "server-kek"; name: string; privateKey: string }
  | { mode: "user-password"; name: string; password: string; privateKey: string };

export type GenerateCustodyWalletInput =
  { mode: "server-kek"; name: string } | { mode: "user-password"; name: string; password: string };

const walletKeys = [
  "address",
  "createdAt",
  "envelopeVersion",
  "lockStatus",
  "mode",
  "name",
  "revision",
  "updatedAt",
  "walletId",
] as const;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const addressPattern = /^0x[0-9a-fA-F]{40}$/u;
const previewKeys = [
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
] as const;
const receiptKeys = [
  "address",
  "auditId",
  "deletedAt",
  "deletionType",
  "finalRevision",
  "walletId",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return keys.length === sorted.length && keys.every((key, index) => key === sorted[index]);
}

function timestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

export function parseCustodyWallet(value: unknown, status = 0): CustodyWallet {
  if (
    !isRecord(value) ||
    !exactKeys(value, walletKeys) ||
    typeof value.walletId !== "string" ||
    !uuidPattern.test(value.walletId) ||
    typeof value.name !== "string" ||
    [...value.name].length < 1 ||
    [...value.name].length > 80 ||
    typeof value.address !== "string" ||
    !addressPattern.test(value.address) ||
    (value.mode !== "server-kek" && value.mode !== "user-password") ||
    (value.lockStatus !== "ready" &&
      value.lockStatus !== "locked" &&
      value.lockStatus !== "quarantined") ||
    !Number.isSafeInteger(value.envelopeVersion) ||
    (value.envelopeVersion as number) < 1 ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 1 ||
    !timestamp(value.createdAt) ||
    !timestamp(value.updatedAt)
  ) {
    throw new WalletRequestError("WALLET_RESPONSE_INVALID", true, status);
  }
  return { ...value } as unknown as CustodyWallet;
}

export function parseCustodyWalletPage(value: unknown, status = 0): CustodyWalletPage {
  if (!isRecord(value) || !exactKeys(value, ["items"]) || !Array.isArray(value.items)) {
    throw new WalletRequestError("WALLET_RESPONSE_INVALID", true, status);
  }
  const items = value.items.map((wallet) => parseCustodyWallet(wallet, status));
  if (new Set(items.map(({ walletId }) => walletId)).size !== items.length) {
    throw new WalletRequestError("WALLET_RESPONSE_INVALID", true, status);
  }
  return { items };
}

function dependencyList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === "string" &&
        item.length > 0 &&
        item.length <= 256 &&
        !/\p{Cc}/u.test(item),
    ) &&
    new Set(value).size === value.length
  );
}

function deleteDependencies(value: unknown): value is WalletDeleteDependencies {
  return (
    isRecord(value) &&
    exactKeys(value, ["assetIds", "policyIds", "positionIds", "taskIds"]) &&
    dependencyList(value.assetIds) &&
    dependencyList(value.policyIds) &&
    dependencyList(value.positionIds) &&
    dependencyList(value.taskIds)
  );
}

export function parseWalletDeletePreview(value: unknown, status = 0): WalletDeletePreview {
  if (
    !isRecord(value) ||
    !exactKeys(value, previewKeys) ||
    !deleteDependencies(value.dependencies) ||
    !Number.isSafeInteger(value.assetCount) ||
    value.assetCount !== value.dependencies.assetIds.length ||
    !Number.isSafeInteger(value.policyCount) ||
    value.policyCount !== value.dependencies.policyIds.length ||
    !Number.isSafeInteger(value.positionCount) ||
    value.positionCount !== value.dependencies.positionIds.length ||
    !Number.isSafeInteger(value.taskCount) ||
    value.taskCount !== value.dependencies.taskIds.length ||
    typeof value.assetRiskDigest !== "string" ||
    value.assetRiskDigest.length < 1 ||
    value.assetRiskDigest.length > 256 ||
    /\p{Cc}/u.test(value.assetRiskDigest) ||
    typeof value.confirmationPhrase !== "string" ||
    !/^DELETE WALLET [A-F0-9]{8}$/u.test(value.confirmationPhrase) ||
    typeof value.expiresAt !== "string" ||
    !timestamp(value.expiresAt) ||
    typeof value.forceEligible !== "boolean" ||
    typeof value.previewToken !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/u.test(value.previewToken) ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 1 ||
    typeof value.walletId !== "string" ||
    !uuidPattern.test(value.walletId)
  ) {
    throw new WalletRequestError("WALLET_RESPONSE_INVALID", true, status);
  }
  return structuredClone(value) as unknown as WalletDeletePreview;
}

export function parseWalletDeletionReceipt(value: unknown, status = 0): WalletDeletionReceipt {
  if (
    !isRecord(value) ||
    !exactKeys(value, receiptKeys) ||
    typeof value.address !== "string" ||
    !addressPattern.test(value.address) ||
    typeof value.auditId !== "string" ||
    value.auditId.length < 1 ||
    value.auditId.length > 64 ||
    typeof value.deletedAt !== "string" ||
    !timestamp(value.deletedAt) ||
    (value.deletionType !== "normal" && value.deletionType !== "force") ||
    !Number.isSafeInteger(value.finalRevision) ||
    (value.finalRevision as number) < 2 ||
    typeof value.walletId !== "string" ||
    !uuidPattern.test(value.walletId)
  ) {
    throw new WalletRequestError("WALLET_RESPONSE_INVALID", true, status);
  }
  return { ...value } as unknown as WalletDeletionReceipt;
}

export class WalletRequestError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly status: number;

  constructor(code: string, retryable: boolean, status: number) {
    super(code);
    this.name = "WalletRequestError";
    this.code = code;
    this.retryable = retryable;
    this.status = status;
  }
}

export class WalletClient {
  readonly #fetcher: WalletFetch;
  readonly #reauthenticationProof: () => string | null;

  constructor(
    fetcher: WalletFetch = globalThis.fetch.bind(globalThis),
    reauthenticationProof: () => string | null = () => null,
  ) {
    this.#fetcher = fetcher;
    this.#reauthenticationProof = reauthenticationProof;
  }

  async list(signal?: AbortSignal): Promise<CustodyWalletPage> {
    const response = await this.#request("/api/wallets", {
      method: "GET",
      ...(signal ? { signal } : {}),
    });
    return parseCustodyWalletPage(response.data, response.status);
  }

  async importWallet(input: ImportCustodyWalletRequest): Promise<CustodyWallet> {
    return this.#secretWalletMutation(
      "/api/wallets/import",
      input,
      "application/vnd.lpbot.wallet-secret+json",
    );
  }

  async generateWallet(input: GenerateCustodyWalletInput): Promise<CustodyWallet> {
    if (input.mode === "user-password") {
      return this.#secretWalletMutation(
        "/api/wallets/generate",
        input,
        "application/vnd.lpbot.wallet-secret+json",
      );
    }
    const response = await this.#request("/api/wallets/generate", {
      body: JSON.stringify(input),
      headers: {
        "Content-Type": "application/json",
        ...this.#reauthenticationHeader(),
      },
      method: "POST",
    });
    return parseCustodyWallet(response.data, response.status);
  }

  async changeEncryptionMode(
    walletId: string,
    input: ChangeWalletEncryptionModeRequest,
  ): Promise<CustodyWallet> {
    if (!uuidPattern.test(walletId)) {
      throw new WalletRequestError("WALLET_NOT_FOUND", false, 0);
    }
    return this.#secretWalletMutation(
      `/api/wallets/${walletId.toLowerCase()}/encryption-mode`,
      input,
      keystoreSecretMediaType,
    );
  }

  async rename(walletId: string, input: RenameCustodyWalletRequest): Promise<CustodyWallet> {
    const normalized = this.#walletId(walletId);
    const response = await this.#request(`/api/wallets/${normalized}`, {
      body: JSON.stringify(input),
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    });
    return parseCustodyWallet(response.data, response.status);
  }

  async deletePreview(walletId: string): Promise<WalletDeletePreview> {
    const normalized = this.#walletId(walletId);
    const response = await this.#request(`/api/wallets/${normalized}/delete-preview`, {
      method: "POST",
    });
    return parseWalletDeletePreview(response.data, response.status);
  }

  async deleteWallet(
    walletId: string,
    input: DeleteCustodyWalletRequest,
  ): Promise<WalletDeletionReceipt> {
    const normalized = this.#walletId(walletId);
    const response = await this.#request(`/api/wallets/${normalized}`, {
      body: JSON.stringify(input),
      headers: {
        "Content-Type": "application/json",
        ...this.#reauthenticationHeader(),
      },
      method: "DELETE",
    });
    return parseWalletDeletionReceipt(response.data, response.status);
  }

  async #secretWalletMutation(
    path: string,
    input:
      ChangeWalletEncryptionModeRequest | GenerateCustodyWalletInput | ImportCustodyWalletRequest,
    contentType: string,
  ): Promise<CustodyWallet> {
    const bytes = new TextEncoder().encode(JSON.stringify(input));
    try {
      const response = await this.#request(path, {
        body: bytes as unknown as BodyInit,
        headers: {
          "Content-Type": contentType,
          ...this.#reauthenticationHeader(),
        },
        method: "POST",
      });
      return parseCustodyWallet(response.data, response.status);
    } finally {
      bytes.fill(0);
    }
  }

  #reauthenticationHeader(): Record<string, string> {
    const proof = this.#reauthenticationProof();
    return proof ? { "X-LPBOT-Reauthentication": proof } : {};
  }

  #walletId(value: string): string {
    if (!uuidPattern.test(value)) {
      throw new WalletRequestError("WALLET_NOT_FOUND", false, 0);
    }
    return value.toLowerCase();
  }

  async #request(path: string, init: RequestInit): Promise<{ data: unknown; status: number }> {
    let response: Response;
    try {
      response = await this.#fetcher(path, {
        ...init,
        cache: "no-store",
        credentials: "include",
        headers: { Accept: "application/json", ...init.headers },
        referrerPolicy: "no-referrer",
      });
    } catch {
      throw new WalletRequestError("NETWORK_ERROR", true, 0);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new WalletRequestError("WALLET_RESPONSE_INVALID", true, response.status);
    }
    if (!response.ok) {
      const envelope = isRecord(body) ? (body as ErrorEnvelope) : null;
      const code =
        typeof envelope?.error?.code === "string" ? envelope.error.code : "WALLET_REQUEST_FAILED";
      const retryable = envelope?.error?.retryable === true;
      throw new WalletRequestError(code, retryable, response.status);
    }
    if (!isRecord(body) || body.success !== true || !Object.hasOwn(body, "data")) {
      throw new WalletRequestError("WALLET_RESPONSE_INVALID", true, response.status);
    }
    return { data: body.data, status: response.status };
  }
}
