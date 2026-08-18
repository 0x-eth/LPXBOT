import {
  transferDigestPattern,
  transferHashPattern,
  validateWalletTransferPlan,
  walletTransferPlanDigest,
} from "@lpbot/domain/wallet-transfer";

import {
  WalletTransferWorkerError,
  type WalletTransferSignerGateway,
  type WalletTransferSignerResult,
} from "./wallet-transfer-worker.js";

const identityPattern = /^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$/u;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const forwardedErrors = new Set([
  "INVALID_CREDENTIALS",
  "SIGNER_UNAVAILABLE",
  "TRANSFER_DELIVERY_UNAVAILABLE",
  "TRANSFER_PLAN_EXPIRED",
  "TRANSFER_PLAN_REJECTED",
]);

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function loopbackSignerUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new RangeError("wallet transfer signer URL is invalid");
  }
  if (
    url.protocol !== "http:" ||
    (url.hostname !== "127.0.0.1" && url.hostname !== "localhost" && url.hostname !== "[::1]") ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    (url.pathname !== "" && url.pathname !== "/")
  ) {
    throw new RangeError("wallet transfer signer URL is invalid");
  }
  return url.origin;
}

function signerFailure(value: unknown): WalletTransferWorkerError {
  if (!record(value) || !exact(value, ["error", "success"]) || value.success !== false) {
    return new WalletTransferWorkerError("SIGNER_UNAVAILABLE", true);
  }
  const error = value.error;
  if (
    !record(error) ||
    !exact(error, ["code", "retryable"]) ||
    typeof error.code !== "string" ||
    typeof error.retryable !== "boolean"
  ) {
    return new WalletTransferWorkerError("SIGNER_UNAVAILABLE", true);
  }
  const code = forwardedErrors.has(error.code) ? error.code : "SIGNER_UNAVAILABLE";
  return new WalletTransferWorkerError(code, code === "SIGNER_UNAVAILABLE" || error.retryable);
}

function signerResult(value: unknown, planDigest: `sha256:${string}`): WalletTransferSignerResult {
  if (!record(value) || !exact(value, ["data", "success"]) || value.success !== true) {
    throw new WalletTransferWorkerError("SIGNER_RESPONSE_INVALID", true);
  }
  const data = value.data;
  if (
    !record(data) ||
    !exact(data, ["deliveryId", "planDigest", "status", "transactionHash"]) ||
    typeof data.deliveryId !== "string" ||
    !identityPattern.test(data.deliveryId) ||
    typeof data.planDigest !== "string" ||
    !transferDigestPattern.test(data.planDigest) ||
    data.planDigest !== planDigest ||
    (data.status !== "accepted" && data.status !== "already-known") ||
    typeof data.transactionHash !== "string" ||
    !transferHashPattern.test(data.transactionHash)
  ) {
    throw new WalletTransferWorkerError("SIGNER_RESPONSE_INVALID", true);
  }
  return {
    deliveryId: data.deliveryId,
    planDigest: data.planDigest as `sha256:${string}`,
    status: data.status,
    transactionHash: data.transactionHash as `0x${string}`,
  };
}

export class LoopbackWalletTransferSignerGateway implements WalletTransferSignerGateway {
  readonly #apiToken: string;
  readonly #fetcher: typeof fetch;
  readonly #timeoutMilliseconds: number;
  readonly #url: string;

  constructor(input: {
    apiToken: string;
    fetch?: typeof fetch;
    timeoutMilliseconds?: number;
    url: string;
  }) {
    if (input.apiToken.length < 32 || input.apiToken.length > 4_096 || /[\r\n]/u.test(input.apiToken)) {
      throw new RangeError("wallet transfer signer token is invalid");
    }
    const timeoutMilliseconds = input.timeoutMilliseconds ?? 10_000;
    if (
      !Number.isSafeInteger(timeoutMilliseconds) ||
      timeoutMilliseconds < 100 ||
      timeoutMilliseconds > 30_000
    ) {
      throw new RangeError("wallet transfer signer timeout is invalid");
    }
    this.#apiToken = input.apiToken;
    this.#fetcher = input.fetch ?? globalThis.fetch.bind(globalThis);
    this.#timeoutMilliseconds = timeoutMilliseconds;
    this.#url = loopbackSignerUrl(input.url);
  }

  async signAndDeliver(
    input: Parameters<WalletTransferSignerGateway["signAndDeliver"]>[0],
  ): Promise<WalletTransferSignerResult> {
    if (
      !identityPattern.test(input.tenantId) ||
      !uuidPattern.test(input.userId) ||
      (input.reauthenticatedSessionId !== undefined &&
        !uuidPattern.test(input.reauthenticatedSessionId))
    ) {
      throw new WalletTransferWorkerError("TRANSFER_SIGNER_IDENTITY_INVALID");
    }
    try {
      validateWalletTransferPlan(input.plan);
    } catch (error) {
      throw new WalletTransferWorkerError(
        error instanceof Error && error.message === "TRANSFER_PLAN_EXPIRED"
          ? "TRANSFER_PLAN_EXPIRED"
          : "TRANSFER_PLAN_INVALID",
      );
    }
    if (walletTransferPlanDigest(input.plan) !== input.planDigest) {
      throw new WalletTransferWorkerError("TRANSFER_PLAN_INVALID");
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMilliseconds);
    try {
      const response = await this.#fetcher(`${this.#url}/v1/wallet-transfers/sign-and-deliver`, {
        body: JSON.stringify({ plan: input.plan, planDigest: input.planDigest }),
        cache: "no-store",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.#apiToken}`,
          "Cache-Control": "no-store",
          "Content-Type": "application/json",
          "X-LPBOT-Tenant-Id": input.tenantId,
          "X-LPBOT-User-Id": input.userId,
          ...(input.reauthenticatedSessionId
            ? { "X-LPBOT-Reauthenticated-Session-Id": input.reauthenticatedSessionId }
            : {}),
        },
        method: "POST",
        redirect: "error",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
      });
      const text = await response.text();
      if (text.length > 16_384) {
        throw new WalletTransferWorkerError("SIGNER_RESPONSE_INVALID", true);
      }
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        throw new WalletTransferWorkerError("SIGNER_RESPONSE_INVALID", true);
      }
      if (!response.ok) throw signerFailure(body);
      return signerResult(body, input.planDigest);
    } catch (error) {
      if (error instanceof WalletTransferWorkerError) throw error;
      throw new WalletTransferWorkerError("SIGNER_UNAVAILABLE", true, { cause: error });
    } finally {
      clearTimeout(timeout);
    }
  }
}
