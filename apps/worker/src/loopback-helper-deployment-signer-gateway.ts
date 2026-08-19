import { helperDeploymentPlanDigest } from "@lpbot/domain/helper-deployment";

import {
  HelperDeploymentWorkerError,
  validateHelperDeploymentWorkPlan,
  type HelperDeploymentSignerGateway,
  type HelperDeploymentSignerResult,
} from "./helper-deployment-worker.js";

const identityPattern = /^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$/u;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const hashPattern = /^0x[0-9a-f]{64}$/u;
const forwardedErrors = new Set([
  "HELPER_DELIVERY_UNAVAILABLE",
  "HELPER_PLAN_EXPIRED",
  "HELPER_PLAN_REJECTED",
  "INVALID_CREDENTIALS",
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
    throw new RangeError("Helper deployment signer URL is invalid");
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
    throw new RangeError("Helper deployment signer URL is invalid");
  }
  return url.origin;
}

function signerFailure(value: unknown): HelperDeploymentWorkerError {
  if (!record(value) || !exact(value, ["error", "success"]) || value.success !== false) {
    return new HelperDeploymentWorkerError("SIGNER_UNAVAILABLE", true);
  }
  const error = value.error;
  if (
    !record(error) ||
    !exact(error, ["code", "retryable"]) ||
    typeof error.code !== "string" ||
    typeof error.retryable !== "boolean"
  ) {
    return new HelperDeploymentWorkerError("SIGNER_UNAVAILABLE", true);
  }
  const code = forwardedErrors.has(error.code) ? error.code : "SIGNER_UNAVAILABLE";
  return new HelperDeploymentWorkerError(code, code === "SIGNER_UNAVAILABLE" || error.retryable);
}

function signerResult(
  value: unknown,
  planDigest: `sha256:${string}`,
): HelperDeploymentSignerResult {
  if (!record(value) || !exact(value, ["data", "success"]) || value.success !== true) {
    throw new HelperDeploymentWorkerError("HELPER_SIGNER_RESPONSE_INVALID", true);
  }
  const data = value.data;
  if (
    !record(data) ||
    !exact(data, ["deliveryId", "planDigest", "status", "transactionHash"]) ||
    typeof data.deliveryId !== "string" ||
    !identityPattern.test(data.deliveryId) ||
    typeof data.planDigest !== "string" ||
    !digestPattern.test(data.planDigest) ||
    data.planDigest !== planDigest ||
    (data.status !== "accepted" && data.status !== "already-known") ||
    typeof data.transactionHash !== "string" ||
    !hashPattern.test(data.transactionHash)
  ) {
    throw new HelperDeploymentWorkerError("HELPER_SIGNER_RESPONSE_INVALID", true);
  }
  return {
    deliveryId: data.deliveryId,
    planDigest: data.planDigest as `sha256:${string}`,
    status: data.status,
    transactionHash: data.transactionHash as `0x${string}`,
  };
}

export class LoopbackHelperDeploymentSignerGateway implements HelperDeploymentSignerGateway {
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
    if (
      input.apiToken.length < 32 ||
      input.apiToken.length > 4_096 ||
      /[\r\n]/u.test(input.apiToken)
    ) {
      throw new RangeError("Helper deployment signer token is invalid");
    }
    const timeoutMilliseconds = input.timeoutMilliseconds ?? 10_000;
    if (
      !Number.isSafeInteger(timeoutMilliseconds) ||
      timeoutMilliseconds < 100 ||
      timeoutMilliseconds > 30_000
    ) {
      throw new RangeError("Helper deployment signer timeout is invalid");
    }
    this.#apiToken = input.apiToken;
    this.#fetch = input.fetch ?? globalThis.fetch.bind(globalThis);
    this.#timeoutMilliseconds = timeoutMilliseconds;
    this.#url = loopbackUrl(input.url);
  }

  async signAndDeliver(
    input: Parameters<HelperDeploymentSignerGateway["signAndDeliver"]>[0],
  ): Promise<HelperDeploymentSignerResult> {
    if (
      !identityPattern.test(input.tenantId) ||
      !uuidPattern.test(input.userId) ||
      (input.reauthenticatedSessionId !== undefined &&
        !uuidPattern.test(input.reauthenticatedSessionId))
    ) {
      throw new HelperDeploymentWorkerError("HELPER_SIGNER_IDENTITY_INVALID");
    }
    try {
      validateHelperDeploymentWorkPlan(input.plan);
    } catch (error) {
      throw new HelperDeploymentWorkerError(
        input.plan.deadline <= new Date().toISOString()
          ? "HELPER_PLAN_EXPIRED"
          : "HELPER_PLAN_INVALID",
        false,
        { cause: error },
      );
    }
    if (
      helperDeploymentPlanDigest(input.plan) !== input.planDigest ||
      input.plan.planDigest !== input.planDigest
    ) {
      throw new HelperDeploymentWorkerError("HELPER_PLAN_INVALID");
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMilliseconds);
    try {
      const response = await this.#fetch(`${this.#url}/v1/helper-deployments/sign-and-deliver`, {
        body: JSON.stringify({ plan: input.plan, planDigest: input.planDigest }),
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
        signal: controller.signal,
      });
      const text = await response.text();
      if (text.length > 16_384) {
        throw new HelperDeploymentWorkerError("HELPER_SIGNER_RESPONSE_INVALID", true);
      }
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        throw new HelperDeploymentWorkerError("HELPER_SIGNER_RESPONSE_INVALID", true);
      }
      if (!response.ok) throw signerFailure(body);
      if (
        response.status !== 202 ||
        response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !==
          "application/json" ||
        !response.headers
          .get("cache-control")
          ?.split(",")
          .some((directive) => directive.trim().toLowerCase() === "no-store")
      ) {
        throw new HelperDeploymentWorkerError("HELPER_SIGNER_RESPONSE_INVALID", true);
      }
      return signerResult(body, input.planDigest);
    } catch (error) {
      if (error instanceof HelperDeploymentWorkerError) throw error;
      throw new HelperDeploymentWorkerError("SIGNER_UNAVAILABLE", true, { cause: error });
    } finally {
      clearTimeout(timeout);
    }
  }
}
