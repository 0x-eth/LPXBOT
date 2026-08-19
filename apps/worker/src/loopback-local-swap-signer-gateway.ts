import { localSwapExecutionPlanDigest } from "@lpbot/domain/local-swap-execution";

import {
  LocalSwapWorkerError,
  type LocalSwapStepSignerGateway,
  type LocalSwapStepSignerResult,
} from "./local-swap-worker.js";

const endpointPattern =
  /^http:\/\/(?:127\.0\.0\.1|\[::1\]):[1-9][0-9]{0,4}\/v1\/local-swap\/steps\/sign-and-deliver$/u;
const identityPattern = /^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$/u;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const hashPattern = /^0x[0-9a-f]{64}$/u;

function signerFailure(value: unknown): LocalSwapWorkerError {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return new LocalSwapWorkerError("SIGNER_UNAVAILABLE", true);
  }
  const envelope = value as Record<string, unknown>;
  const error = envelope.error;
  if (typeof error !== "object" || error === null || Array.isArray(error)) {
    return new LocalSwapWorkerError("SIGNER_UNAVAILABLE", true);
  }
  const code = (error as Record<string, unknown>).code;
  const retryable = (error as Record<string, unknown>).retryable;
  return new LocalSwapWorkerError(
    typeof code === "string" && code.length <= 120 ? code : "SIGNER_UNAVAILABLE",
    retryable === true,
  );
}

function signingResult(value: unknown): LocalSwapStepSignerResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new LocalSwapWorkerError("LOCAL_SWAP_SIGNER_RESPONSE_INVALID", true);
  }
  const envelope = value as Record<string, unknown>;
  if (
    Object.keys(envelope).sort().join(",") !== "data,success" ||
    envelope.success !== true ||
    typeof envelope.data !== "object" ||
    envelope.data === null ||
    Array.isArray(envelope.data)
  ) {
    throw new LocalSwapWorkerError("LOCAL_SWAP_SIGNER_RESPONSE_INVALID", true);
  }
  const data = envelope.data as Record<string, unknown>;
  if (
    Object.keys(data).sort().join(",") !==
      "deliveryId,generation,planDigest,status,stepId,transactionHash" ||
    typeof data.deliveryId !== "string" ||
    !identityPattern.test(data.deliveryId) ||
    !Number.isSafeInteger(data.generation) ||
    Number(data.generation) < 0 ||
    typeof data.planDigest !== "string" ||
    !digestPattern.test(data.planDigest) ||
    (data.status !== "accepted" && data.status !== "already-known") ||
    typeof data.stepId !== "string" ||
    !uuidPattern.test(data.stepId) ||
    typeof data.transactionHash !== "string" ||
    !hashPattern.test(data.transactionHash)
  ) {
    throw new LocalSwapWorkerError("LOCAL_SWAP_SIGNER_RESPONSE_INVALID", true);
  }
  return data as unknown as LocalSwapStepSignerResult;
}

export class LoopbackLocalSwapSignerGateway implements LocalSwapStepSignerGateway {
  readonly #authorization: string;
  readonly #endpoint: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMilliseconds: number;

  constructor(input: {
    endpoint: string;
    fetch?: typeof fetch;
    timeoutMilliseconds?: number;
    token: string;
  }) {
    if (!endpointPattern.test(input.endpoint)) {
      throw new RangeError("LOCAL_SWAP_SIGNER_ENDPOINT_INVALID");
    }
    if (input.token.length < 32 || input.token.length > 512 || /\s/u.test(input.token)) {
      throw new RangeError("LOCAL_SWAP_SIGNER_TOKEN_INVALID");
    }
    this.#authorization = `Bearer ${input.token}`;
    this.#endpoint = input.endpoint;
    this.#fetch = input.fetch ?? fetch;
    this.#timeoutMilliseconds = input.timeoutMilliseconds ?? 10_000;
  }

  async signAndDeliver(input: Parameters<LocalSwapStepSignerGateway["signAndDeliver"]>[0]) {
    const step = input.plan.steps.find(({ stepId }) => stepId === input.stepId);
    if (
      !step ||
      input.plan.planDigest !== input.planDigest ||
      localSwapExecutionPlanDigest(input.plan) !== input.planDigest ||
      input.plan.chainId !== 31_337 ||
      !identityPattern.test(input.tenantId) ||
      !uuidPattern.test(input.userId) ||
      !Number.isSafeInteger(input.generation) ||
      input.generation < 0
    ) {
      throw new LocalSwapWorkerError("LOCAL_SWAP_PLAN_INVALID");
    }
    let response: Response;
    try {
      response = await this.#fetch(this.#endpoint, {
        body: JSON.stringify({
          generation: input.generation,
          maxFeePerGasBaseUnit: input.maxFeePerGasBaseUnit,
          maxPriorityFeePerGasBaseUnit: input.maxPriorityFeePerGasBaseUnit,
          plan: input.plan,
          planDigest: input.planDigest,
          stepId: input.stepId,
        }),
        headers: {
          Accept: "application/json",
          Authorization: this.#authorization,
          "Cache-Control": "no-store",
          "Content-Type": "application/json",
          ...(input.reauthenticatedSessionId
            ? { "X-LPBOT-Reauthenticated-Session-Id": input.reauthenticatedSessionId }
            : {}),
          "X-LPBOT-Tenant-Id": input.tenantId,
          "X-LPBOT-User-Id": input.userId,
        },
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(this.#timeoutMilliseconds),
      });
    } catch (error) {
      throw new LocalSwapWorkerError("SIGNER_UNAVAILABLE", true, { cause: error });
    }
    const raw = await response.text();
    if (Buffer.byteLength(raw) > 65_536) {
      throw new LocalSwapWorkerError("LOCAL_SWAP_SIGNER_RESPONSE_INVALID", true);
    }
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new LocalSwapWorkerError("LOCAL_SWAP_SIGNER_RESPONSE_INVALID", true);
    }
    if (
      response.headers.get("content-type")?.split(";", 1)[0] !== "application/json" ||
      response.headers.get("cache-control") !== "no-store"
    )
      throw new LocalSwapWorkerError("LOCAL_SWAP_SIGNER_RESPONSE_INVALID", true);
    if (response.status !== 202) throw signerFailure(value);
    const result = signingResult(value);
    if (
      result.planDigest !== input.planDigest ||
      result.stepId !== input.stepId ||
      result.generation !== input.generation
    )
      throw new LocalSwapWorkerError("LOCAL_SWAP_SIGNER_RESPONSE_INVALID", true);
    return result;
  }
}
