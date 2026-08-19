import {
  localSwapPermit2AuthorizationDigest,
  type LocalSwapPermit2SigningPayload,
} from "@lpbot/domain/local-swap-execution";

import {
  LocalSwapExecutionError,
  type LocalSwapPermit2SignatureProvider,
} from "./local-swap-executions.js";

const loopbackEndpointPattern = /^http:\/\/(?:127\.0\.0\.1|\[::1\]):[1-9][0-9]{0,4}\/v1\/local-swap\/permit2\/sign$/u;
const identityPattern = /^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$/u;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export class RemoteLocalSwapPermit2Client implements LocalSwapPermit2SignatureProvider {
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
    if (!loopbackEndpointPattern.test(input.endpoint)) {
      throw new RangeError("LOCAL_SWAP_PERMIT2_SIGNER_ENDPOINT_INVALID");
    }
    if (input.token.length < 32 || input.token.length > 512 || /\s/u.test(input.token)) {
      throw new RangeError("LOCAL_SWAP_PERMIT2_SIGNER_TOKEN_INVALID");
    }
    this.#endpoint = input.endpoint;
    this.#authorization = `Bearer ${input.token}`;
    this.#fetch = input.fetch ?? fetch;
    this.#timeoutMilliseconds = input.timeoutMilliseconds ?? 5_000;
  }

  async sign(input: Parameters<LocalSwapPermit2SignatureProvider["sign"]>[0]) {
    if (
      !identityPattern.test(input.tenantId) ||
      !uuidPattern.test(input.userId) ||
      !uuidPattern.test(input.reauthenticatedSessionId)
    ) {
      throw new LocalSwapExecutionError("PERMIT2_AUTHORIZATION_INVALID");
    }
    const payload: LocalSwapPermit2SigningPayload = {
      amountBaseUnit: input.amountBaseUnit,
      domainSeparator: input.domainSeparator,
      expiration: input.expiration,
      nonce: input.nonce,
      permit2: input.permit2,
      quoteDigest: input.quoteDigest,
      sigDeadline: input.sigDeadline,
      spender: input.spender,
      token: input.token,
      walletId: input.walletId,
    };
    const expectedDigest = localSwapPermit2AuthorizationDigest(payload);
    let response: Response;
    try {
      response = await this.#fetch(this.#endpoint, {
        body: JSON.stringify({ payload }),
        cache: "no-store",
        headers: {
          Authorization: this.#authorization,
          "Content-Type": "application/json",
          "X-LPBOT-Reauthenticated-Session-Id": input.reauthenticatedSessionId,
          "X-LPBOT-Tenant-Id": input.tenantId,
          "X-LPBOT-User-Id": input.userId,
        },
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(this.#timeoutMilliseconds),
      });
    } catch (error) {
      throw new LocalSwapExecutionError("LOCAL_SWAP_UNAVAILABLE", true, { cause: error });
    }
    if (
      response.status !== 200 ||
      response.headers.get("content-type")?.split(";", 1)[0] !== "application/json" ||
      response.headers.get("cache-control") !== "no-store"
    ) {
      throw new LocalSwapExecutionError("PERMIT2_AUTHORIZATION_INVALID");
    }
    const raw = await response.text();
    if (Buffer.byteLength(raw) > 16_384) {
      throw new LocalSwapExecutionError("PERMIT2_AUTHORIZATION_INVALID");
    }
    let value: unknown;
    try { value = JSON.parse(raw); } catch { throw new LocalSwapExecutionError("PERMIT2_AUTHORIZATION_INVALID"); }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new LocalSwapExecutionError("PERMIT2_AUTHORIZATION_INVALID");
    }
    const envelope = value as Record<string, unknown>;
    if (Object.keys(envelope).sort().join(",") !== "data,success" || envelope.success !== true ||
      typeof envelope.data !== "object" || envelope.data === null || Array.isArray(envelope.data)) {
      throw new LocalSwapExecutionError("PERMIT2_AUTHORIZATION_INVALID");
    }
    const data = envelope.data as Record<string, unknown>;
    if (
      Object.keys(data).sort().join(",") !== "authorizationDigest,signature" ||
      data.authorizationDigest !== expectedDigest ||
      typeof data.signature !== "string" ||
      !/^0x[0-9a-f]{130}$/u.test(data.signature)
    ) {
      throw new LocalSwapExecutionError("PERMIT2_AUTHORIZATION_INVALID");
    }
    return { signature: data.signature as `0x${string}` };
  }
}
