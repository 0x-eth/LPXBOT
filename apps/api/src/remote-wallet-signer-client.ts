import type { CustodyWallet } from "@lpbot/api-contract";

import {
  keystoreSecretMediaType,
  publicKeystoreResetPreview,
  publicKeystoreStatus,
  publicWalletDeletePreview,
  publicWalletDeletionReceipt,
  publicWalletDto,
  WalletApiError,
  type KeystoreApplication,
  type WalletApiErrorCode,
  type WalletSignerClient,
  walletSecretMediaType,
} from "./wallets.js";

const identityPattern = /^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$/u;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const forwardedErrors = new Set<WalletApiErrorCode>([
  "CONFIRMATION_MISMATCH",
  "DELETE_BLOCKED",
  "INVALID_AUTO_LOCK",
  "INVALID_CREDENTIALS",
  "INVALID_MODE",
  "INVALID_PRIVATE_KEY",
  "INVALID_WALLET",
  "LOCKED_OUT",
  "PASSWORD_ALREADY_CONFIGURED",
  "PASSWORD_POLICY_FAILED",
  "PREVIEW_CHANGED",
  "PREVIEW_EXPIRED",
  "REVISION_CONFLICT",
  "SECRET_VERSION_CONFLICT",
  "WALLET_ADDRESS_EXISTS",
  "WALLET_NOT_FOUND",
]);

function signerUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new WalletApiError("SIGNER_UNAVAILABLE");
  }
  if (
    parsed.protocol !== "http:" ||
    (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "[::1]") ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0 ||
    (parsed.pathname !== "/" && parsed.pathname !== "")
  ) {
    throw new WalletApiError("SIGNER_UNAVAILABLE");
  }
  return parsed.origin;
}

function responseRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function remoteError(value: unknown): WalletApiError {
  const envelope = responseRecord(value);
  const error = responseRecord(envelope?.error);
  const code = error?.code;
  return new WalletApiError(
    typeof code === "string" && forwardedErrors.has(code as WalletApiErrorCode)
      ? (code as WalletApiErrorCode)
      : "SIGNER_UNAVAILABLE",
  );
}

interface RemoteOwner {
  reauthenticatedSessionId?: string | undefined;
  tenantId?: string | undefined;
  userId: string;
}

export class RemoteWalletSignerClient implements WalletSignerClient, KeystoreApplication {
  readonly #apiToken: string;
  readonly #fetcher: typeof fetch;
  readonly #tenantId: string;
  readonly #url: string;

  constructor(input: { apiToken: string; fetcher?: typeof fetch; tenantId?: string; url: string }) {
    if (
      input.apiToken.length < 32 ||
      input.apiToken.length > 4096 ||
      /[\r\n]/u.test(input.apiToken)
    ) {
      throw new WalletApiError("SIGNER_UNAVAILABLE");
    }
    const tenantId = input.tenantId ?? "lpbot";
    if (!identityPattern.test(tenantId)) throw new WalletApiError("SIGNER_UNAVAILABLE");
    this.#apiToken = input.apiToken;
    this.#fetcher = input.fetcher ?? globalThis.fetch.bind(globalThis);
    this.#tenantId = tenantId;
    this.#url = signerUrl(input.url);
  }

  async generateWallet(input: Parameters<WalletSignerClient["generateWallet"]>[0]) {
    if (input.ingress) {
      return this.#secretWalletRequest(
        "/v1/wallets/generate",
        input,
        input.ingress,
        walletSecretMediaType,
      );
    }
    return publicWalletDto(
      await this.#requestData(
        "/v1/wallets/generate",
        input,
        { body: JSON.stringify(input), method: "POST" },
        "application/json",
      ),
    );
  }

  async importWallet(input: Parameters<WalletSignerClient["importWallet"]>[0]) {
    return this.#secretWalletRequest(
      "/v1/wallets/import",
      input,
      input.ingress,
      walletSecretMediaType,
    );
  }

  async renameWallet(input: {
    expectedRevision: number;
    name: string;
    updatedAt: Date;
    userId: string;
    walletId: string;
  }) {
    return publicWalletDto(
      await this.#requestData(
        `/v1/wallets/${input.walletId}`,
        input,
        {
          body: JSON.stringify({
            expectedRevision: input.expectedRevision,
            name: input.name,
            updatedAt: input.updatedAt.toISOString(),
          }),
          method: "PATCH",
        },
        "application/json",
      ),
    );
  }

  async createWalletDeletePreview(userId: string, walletId: string) {
    return publicWalletDeletePreview(
      await this.#requestData(
        `/v1/wallets/${walletId}/delete-preview`,
        { userId },
        { method: "POST" },
      ),
    );
  }

  async deleteWallet(input: {
    confirmationPhrase?: string;
    dependencies?: {
      assetIds: string[];
      policyIds: string[];
      positionIds: string[];
      taskIds: string[];
    };
    expectedRevision: number;
    force: boolean;
    previewToken: string;
    userId: string;
    walletId: string;
  }) {
    return publicWalletDeletionReceipt(
      await this.#requestData(
        `/v1/wallets/${input.walletId}`,
        input,
        {
          body: JSON.stringify(
            input.force
              ? {
                  confirmationPhrase: input.confirmationPhrase,
                  dependencies: input.dependencies,
                  expectedRevision: input.expectedRevision,
                  force: true,
                  previewToken: input.previewToken,
                }
              : {
                  expectedRevision: input.expectedRevision,
                  force: false,
                  previewToken: input.previewToken,
                },
          ),
          method: "DELETE",
        },
        "application/json",
      ),
    );
  }

  async keystoreStatus(userId: string, reauthenticatedSessionId?: string) {
    return publicKeystoreStatus(
      await this.#requestData("/v1/keystore/status", {
        reauthenticatedSessionId,
        userId,
      }),
    );
  }

  async unlockKeystore(input: Parameters<KeystoreApplication["unlockKeystore"]>[0]) {
    return this.#secretStatusRequest("/v1/keystore/unlock", input, input.ingress, "POST");
  }

  async lockKeystore(userId: string) {
    return publicKeystoreStatus(
      await this.#requestData("/v1/keystore/lock", { userId }, { method: "POST" }),
    );
  }

  async updateKeystoreAutoLock(
    input: Parameters<KeystoreApplication["updateKeystoreAutoLock"]>[0],
  ) {
    return publicKeystoreStatus(
      await this.#requestData(
        "/v1/keystore/auto-lock",
        input,
        {
          body: JSON.stringify({
            expectedVersion: input.expectedVersion,
            minutes: input.minutes,
          }),
          method: "PATCH",
        },
        "application/json",
      ),
    );
  }

  async createKeystorePassword(
    input: Parameters<KeystoreApplication["createKeystorePassword"]>[0],
  ) {
    return this.#secretStatusRequest("/v1/keystore/password", input, input.ingress, "POST");
  }

  async changeKeystorePassword(
    input: Parameters<KeystoreApplication["changeKeystorePassword"]>[0],
  ) {
    return this.#secretStatusRequest("/v1/keystore/password", input, input.ingress, "PUT");
  }

  async createKeystoreResetPreview(userId: string) {
    return publicKeystoreResetPreview(
      await this.#requestData("/v1/keystore/reset-preview", { userId }),
    );
  }

  async resetKeystore(input: Parameters<KeystoreApplication["resetKeystore"]>[0]) {
    return this.#secretStatusRequest("/v1/keystore/reset", input, input.ingress, "POST");
  }

  async changeWalletEncryptionMode(
    input: Parameters<KeystoreApplication["changeWalletEncryptionMode"]>[0],
  ) {
    return this.#secretWalletRequest(
      `/v1/wallets/${input.walletId}/encryption-mode`,
      input,
      input.ingress,
      keystoreSecretMediaType,
    );
  }

  async #secretStatusRequest(
    path: string,
    owner: RemoteOwner,
    ingress: Uint8Array,
    method: "POST" | "PUT",
  ) {
    const transportCopy = Buffer.from(ingress);
    try {
      return publicKeystoreStatus(
        await this.#requestData(
          path,
          owner,
          { body: transportCopy, method },
          keystoreSecretMediaType,
        ),
      );
    } finally {
      transportCopy.fill(0);
    }
  }

  async #secretWalletRequest(
    path: string,
    owner: RemoteOwner,
    ingress: Uint8Array,
    contentType: string,
  ): Promise<CustodyWallet> {
    const transportCopy = Buffer.from(ingress);
    try {
      return publicWalletDto(
        await this.#requestData(path, owner, { body: transportCopy, method: "POST" }, contentType),
      );
    } finally {
      transportCopy.fill(0);
    }
  }

  async #requestData(
    path: string,
    owner: RemoteOwner,
    init: RequestInit = { method: "GET" },
    contentType?: string,
  ): Promise<unknown> {
    const tenantId = owner.tenantId ?? this.#tenantId;
    if (
      !identityPattern.test(tenantId) ||
      !uuidPattern.test(owner.userId) ||
      (owner.reauthenticatedSessionId !== undefined &&
        !uuidPattern.test(owner.reauthenticatedSessionId))
    ) {
      throw new WalletApiError("SIGNER_UNAVAILABLE");
    }
    let response: Response;
    try {
      response = await this.#fetcher(`${this.#url}${path}`, {
        ...init,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.#apiToken}`,
          "Cache-Control": "no-store",
          ...(contentType ? { "Content-Type": contentType } : {}),
          "X-LPBOT-Tenant-Id": tenantId,
          "X-LPBOT-User-Id": owner.userId.toLowerCase(),
          ...(owner.reauthenticatedSessionId
            ? {
                "X-LPBOT-Reauthenticated-Session-Id": owner.reauthenticatedSessionId.toLowerCase(),
              }
            : {}),
        },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new WalletApiError("SIGNER_UNAVAILABLE");
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new WalletApiError("SIGNER_UNAVAILABLE");
    }
    if (!response.ok) throw remoteError(payload);
    const envelope = responseRecord(payload);
    if (envelope?.success !== true || !Object.hasOwn(envelope, "data")) {
      throw new WalletApiError("SIGNER_UNAVAILABLE");
    }
    return envelope.data;
  }
}
