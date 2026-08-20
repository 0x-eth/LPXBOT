import { localHelperUpgradePlanDigest } from "@lpbot/domain/local-helper-upgrade";

import {
  LocalHelperUpgradeWorkerError,
  validateLocalHelperUpgradeWorkPlan,
  type LocalHelperUpgradeSignerGateway,
  type LocalHelperUpgradeSignerResult,
} from "./local-helper-upgrade-worker.js";

const identityPattern = /^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$/u;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const hashPattern = /^0x[0-9a-f]{64}$/u;

const forwardedErrors = new Set([
  "INVALID_CREDENTIALS",
  "LOCAL_HELPER_UPGRADE_DELIVERY_UNAVAILABLE",
  "LOCAL_HELPER_UPGRADE_PLAN_EXPIRED",
  "LOCAL_HELPER_UPGRADE_PLAN_REJECTED",
  "SIGNER_UNAVAILABLE",
]);

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function loopbackUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new RangeError("LOCAL_HELPER_UPGRADE_SIGNER_URL_INVALID");
  }
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    (url.pathname !== "" && url.pathname !== "/")
  ) {
    throw new RangeError("LOCAL_HELPER_UPGRADE_SIGNER_URL_INVALID");
  }
  return url.origin;
}

function failure(value: unknown): LocalHelperUpgradeWorkerError {
  if (!record(value) || !exact(value, ["error", "success"]) || value.success !== false) {
    return new LocalHelperUpgradeWorkerError("SIGNER_UNAVAILABLE", true);
  }
  const error = value.error;
  if (
    !record(error) ||
    !exact(error, ["code", "retryable"]) ||
    typeof error.code !== "string" ||
    typeof error.retryable !== "boolean"
  ) {
    return new LocalHelperUpgradeWorkerError("SIGNER_UNAVAILABLE", true);
  }
  const code = forwardedErrors.has(error.code) ? error.code : "SIGNER_UNAVAILABLE";
  return new LocalHelperUpgradeWorkerError(code, code === "SIGNER_UNAVAILABLE" || error.retryable);
}

function result(
  value: unknown,
  expected: { generation: number; operationId: string; planDigest: `sha256:${string}` },
): LocalHelperUpgradeSignerResult {
  if (!record(value) || !exact(value, ["data", "success"]) || value.success !== true) {
    throw new LocalHelperUpgradeWorkerError("HELPER_UPGRADE_SIGNER_RESPONSE_INVALID", true);
  }
  const data = value.data;
  if (
    !record(data) ||
    !exact(data, [
      "deliveryId",
      "generation",
      "operationId",
      "planDigest",
      "status",
      "transactionHash",
    ]) ||
    typeof data.deliveryId !== "string" ||
    !identityPattern.test(data.deliveryId) ||
    data.generation !== expected.generation ||
    data.operationId !== expected.operationId ||
    data.planDigest !== expected.planDigest ||
    (data.status !== "accepted" && data.status !== "already-known") ||
    typeof data.transactionHash !== "string" ||
    !hashPattern.test(data.transactionHash)
  ) {
    throw new LocalHelperUpgradeWorkerError("HELPER_UPGRADE_SIGNER_RESPONSE_INVALID", true);
  }
  return data as unknown as LocalHelperUpgradeSignerResult;
}

export class LoopbackLocalHelperUpgradeSignerGateway implements LocalHelperUpgradeSignerGateway {
  readonly #apiToken: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMilliseconds: number;
  readonly #url: string;

  constructor(input: {
    apiToken: string;
    fetch?: typeof fetch;
    timeoutMilliseconds?: number;
    url: string;
  }) {
    if (input.apiToken.length < 32 || input.apiToken.length > 4_096 || /[\r\n]/u.test(input.apiToken)) {
      throw new RangeError("LOCAL_HELPER_UPGRADE_SIGNER_TOKEN_INVALID");
    }
    this.#timeoutMilliseconds = input.timeoutMilliseconds ?? 10_000;
    if (
      !Number.isSafeInteger(this.#timeoutMilliseconds) ||
      this.#timeoutMilliseconds < 100 ||
      this.#timeoutMilliseconds > 30_000
    ) {
      throw new RangeError("LOCAL_HELPER_UPGRADE_SIGNER_TIMEOUT_INVALID");
    }
    this.#apiToken = input.apiToken;
    this.#fetch = input.fetch ?? globalThis.fetch.bind(globalThis);
    this.#url = loopbackUrl(input.url);
  }

  async signAndDeliver(
    input: Parameters<LocalHelperUpgradeSignerGateway["signAndDeliver"]>[0],
  ): Promise<LocalHelperUpgradeSignerResult> {
    if (
      !identityPattern.test(input.tenantId) ||
      !uuidPattern.test(input.userId) ||
      !uuidPattern.test(input.operationId) ||
      !uuidPattern.test(input.reauthenticatedSessionId) ||
      !Number.isSafeInteger(input.generation) ||
      input.generation < 0 ||
      !digestPattern.test(input.planDigest)
    ) {
      throw new LocalHelperUpgradeWorkerError("HELPER_UPGRADE_SIGNER_IDENTITY_INVALID");
    }
    try {
      validateLocalHelperUpgradeWorkPlan(input.plan);
    } catch (error) {
      throw new LocalHelperUpgradeWorkerError(
        input.plan.deadline <= new Date().toISOString()
          ? "LOCAL_HELPER_UPGRADE_PLAN_EXPIRED"
          : "LOCAL_HELPER_UPGRADE_PLAN_REJECTED",
        false,
        { cause: error },
      );
    }
    if (
      input.plan.operationId !== input.operationId ||
      input.plan.planDigest !== input.planDigest ||
      localHelperUpgradePlanDigest(input.plan) !== input.planDigest
    ) {
      throw new LocalHelperUpgradeWorkerError("LOCAL_HELPER_UPGRADE_PLAN_REJECTED");
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMilliseconds);
    try {
      const response = await this.#fetch(
        `${this.#url}/v1/local-helper-upgrades/sign-and-deliver`,
        {
          body: JSON.stringify({
            generation: input.generation,
            maxFeePerGasBaseUnit: input.maxFeePerGasBaseUnit,
            maxPriorityFeePerGasBaseUnit: input.maxPriorityFeePerGasBaseUnit,
            operationId: input.operationId,
            plan: input.plan,
            planDigest: input.planDigest,
          }),
          headers: {
            authorization: `Bearer ${this.#apiToken}`,
            "content-type": "application/json",
            "x-lpbot-reauthenticated-session-id": input.reauthenticatedSessionId,
            "x-lpbot-tenant-id": input.tenantId,
            "x-lpbot-user-id": input.userId,
          },
          method: "POST",
          signal: controller.signal,
        },
      );
      let parsed: unknown;
      try {
        parsed = await response.json();
      } catch {
        throw new LocalHelperUpgradeWorkerError("SIGNER_UNAVAILABLE", true);
      }
      if (!response.ok) throw failure(parsed);
      return result(parsed, input);
    } catch (error) {
      if (error instanceof LocalHelperUpgradeWorkerError) throw error;
      throw new LocalHelperUpgradeWorkerError("SIGNER_UNAVAILABLE", true, { cause: error });
    } finally {
      clearTimeout(timer);
    }
  }
}
