import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import {
  okxKeySecretBodyLimit,
  okxKeySecretMediaType,
  type OkxKeyStatus,
} from "@lpbot/api-contract";

import { asOkxConnectorError, OkxConnectorError } from "./errors.js";
import type { OkxCredentialService } from "./service.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function authorized(request: IncomingMessage, expected: Buffer): boolean {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) return false;
  const actual = digest(authorization.slice(7));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of request) {
      const bytes = Buffer.isBuffer(chunk) ? Buffer.from(chunk) : Buffer.from(chunk as Uint8Array);
      size += bytes.length;
      if (size > okxKeySecretBodyLimit) {
        bytes.fill(0);
        throw new OkxConnectorError("INVALID_CREDENTIAL_INGRESS");
      }
      chunks.push(bytes);
    }
    return Buffer.concat(chunks);
  } finally {
    for (const chunk of chunks) chunk.fill(0);
  }
}

function send(response: ServerResponse, statusCode: number, body: unknown): void {
  const serialized = JSON.stringify(body);
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(serialized),
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(serialized);
}

function success(response: ServerResponse, status: OkxKeyStatus): void {
  send(response, 200, { data: status, success: true });
}

function failure(response: ServerResponse, error: unknown): void {
  const connectorError = asOkxConnectorError(error);
  const statusCode =
    connectorError.code === "INVALID_CREDENTIAL_INGRESS"
      ? 400
      : connectorError.code === "VERSION_CONFLICT" ||
          connectorError.code === "CREDENTIAL_ALREADY_CONFIGURED" ||
          connectorError.code === "CAPABILITY_EXPIRED"
        ? 409
        : connectorError.code === "CREDENTIAL_INVALID" ||
            connectorError.code === "INSUFFICIENT_PERMISSION"
          ? 422
          : 503;
  send(response, statusCode, {
    error: { code: connectorError.code, retryable: connectorError.retryable },
    success: false,
  });
}

function parseRecord(body: Buffer): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(body.toString("utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new OkxConnectorError("INVALID_CREDENTIAL_INGRESS");
  }
}

function expectedVersion(record: Record<string, unknown>, expectedKeys: readonly string[]): number {
  if (
    Object.keys(record).sort().join(",") !== [...expectedKeys].sort().join(",") ||
    typeof record.expectedVersion !== "number" ||
    !Number.isSafeInteger(record.expectedVersion) ||
    record.expectedVersion < 0
  ) {
    throw new OkxConnectorError("INVALID_CREDENTIAL_INGRESS");
  }
  return record.expectedVersion;
}

function context(request: IncomingMessage): {
  actor: string;
  now: Date;
  requestId: string;
  userId: string;
} {
  const userId = request.headers["x-lpbot-user-id"];
  const actor = request.headers["x-lpbot-actor"];
  const requestId = request.headers["x-lpbot-request-id"];
  if (
    typeof userId !== "string" ||
    !uuidPattern.test(userId) ||
    typeof actor !== "string" ||
    actor.length < 1 ||
    actor.length > 160 ||
    typeof requestId !== "string" ||
    requestId.length < 1 ||
    requestId.length > 160
  ) {
    throw new OkxConnectorError("INVALID_CREDENTIAL_INGRESS");
  }
  return { actor, now: new Date(), requestId, userId };
}

export function createOkxConnectorHttpServer(input: {
  apiToken: string;
  service: OkxCredentialService;
}): Server {
  const expectedToken = digest(input.apiToken);
  return createServer(async (request, response) => {
    response.setHeader("Connection", "close");
    let body: Buffer | null = null;
    let replacementBody: Buffer | null = null;
    try {
      if (!authorized(request, expectedToken)) {
        send(response, 401, {
          error: { code: "CONNECTOR_UNAUTHENTICATED", retryable: false },
          success: false,
        });
        return;
      }
      const route = new URL(request.url ?? "/", "http://connector.invalid").pathname;
      const operationContext = context(request);
      if (request.method === "GET" && route === "/v1/okx-key") {
        success(response, await input.service.status(operationContext.userId));
        return;
      }
      const mediaType = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
      if (mediaType !== okxKeySecretMediaType) {
        send(response, 415, {
          error: { code: "UNSUPPORTED_MEDIA_TYPE", retryable: false },
          success: false,
        });
        return;
      }
      body = await readBody(request);
      if (request.method === "POST" && route === "/v1/okx-key") {
        success(response, await input.service.save({ ...operationContext, ingress: body }));
        return;
      }
      if (request.method === "PUT" && route === "/v1/okx-key") {
        const record = parseRecord(body);
        const version = expectedVersion(record, [
          "apiKey",
          "expectedVersion",
          "passphrase",
          "secretKey",
        ]);
        if (
          typeof record.apiKey !== "string" ||
          typeof record.secretKey !== "string" ||
          typeof record.passphrase !== "string"
        ) {
          throw new OkxConnectorError("INVALID_CREDENTIAL_INGRESS");
        }
        replacementBody = Buffer.from(
          JSON.stringify({
            apiKey: record.apiKey,
            passphrase: record.passphrase,
            secretKey: record.secretKey,
          }),
          "utf8",
        );
        record.apiKey = "";
        record.secretKey = "";
        record.passphrase = "";
        success(
          response,
          await input.service.replace({
            ...operationContext,
            expectedVersion: version,
            ingress: replacementBody,
          }),
        );
        return;
      }
      if (
        (request.method === "DELETE" && route === "/v1/okx-key") ||
        (request.method === "POST" && route === "/v1/okx-key/test")
      ) {
        const version = expectedVersion(parseRecord(body), ["expectedVersion"]);
        const result =
          request.method === "DELETE"
            ? await input.service.delete({ ...operationContext, expectedVersion: version })
            : await input.service.test({ ...operationContext, expectedVersion: version });
        success(response, result);
        return;
      }
      send(response, 404, {
        error: { code: "CONNECTOR_ROUTE_NOT_FOUND", retryable: false },
        success: false,
      });
    } catch (error) {
      failure(response, error);
    } finally {
      body?.fill(0);
      replacementBody?.fill(0);
    }
  });
}
