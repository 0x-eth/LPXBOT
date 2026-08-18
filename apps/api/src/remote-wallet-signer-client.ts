import type { CustodyWallet } from "@lpbot/api-contract";

import {
  publicWalletDto,
  WalletApiError,
  type WalletApiErrorCode,
  type WalletSignerClient,
  walletSecretMediaType,
} from "./wallets.js";

const identityPattern = /^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$/u;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const forwardedErrors = new Set<WalletApiErrorCode>([
  "INVALID_MODE",
  "INVALID_PRIVATE_KEY",
  "INVALID_WALLET",
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

export class RemoteWalletSignerClient implements WalletSignerClient {
  readonly #apiToken: string;
  readonly #fetcher: typeof fetch;
  readonly #url: string;

  constructor(input: { apiToken: string; fetcher?: typeof fetch; url: string }) {
    if (input.apiToken.length < 32 || input.apiToken.length > 4096 || /[\r\n]/u.test(input.apiToken)) {
      throw new WalletApiError("SIGNER_UNAVAILABLE");
    }
    this.#apiToken = input.apiToken;
    this.#fetcher = input.fetcher ?? globalThis.fetch.bind(globalThis);
    this.#url = signerUrl(input.url);
  }

  async generateWallet(input: Parameters<WalletSignerClient["generateWallet"]>[0]) {
    return this.#request("/v1/wallets/generate", input, JSON.stringify(input));
  }

  async importWallet(input: Parameters<WalletSignerClient["importWallet"]>[0]) {
    const transportCopy = Buffer.from(input.ingress);
    try {
      return await this.#request("/v1/wallets/import", input, transportCopy, walletSecretMediaType);
    } finally {
      transportCopy.fill(0);
    }
  }

  async #request(
    path: string,
    owner: { tenantId: string; userId: string },
    body: BodyInit,
    contentType = "application/json",
  ): Promise<CustodyWallet> {
    if (!identityPattern.test(owner.tenantId) || !uuidPattern.test(owner.userId)) {
      throw new WalletApiError("SIGNER_UNAVAILABLE");
    }
    let response: Response;
    try {
      response = await this.#fetcher(`${this.#url}${path}`, {
        body,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.#apiToken}`,
          "Cache-Control": "no-store",
          "Content-Type": contentType,
          "X-LPBOT-Tenant-Id": owner.tenantId,
          "X-LPBOT-User-Id": owner.userId.toLowerCase(),
        },
        method: "POST",
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
    if (envelope?.success !== true) throw new WalletApiError("SIGNER_UNAVAILABLE");
    return publicWalletDto(envelope.data);
  }
}
