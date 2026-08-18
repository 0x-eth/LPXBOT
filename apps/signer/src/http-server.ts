import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import type { CustodySignerService } from "./custody-signer-service.js";
import { SignerError, asSignerError } from "./signer-error.js";

const bodyLimit = 16_384;
const identityPattern = /^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$/u;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function tokenDigest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function authorized(request: IncomingMessage, expectedDigest: Buffer): boolean {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) return false;
  const received = tokenDigest(authorization.slice("Bearer ".length));
  return timingSafeEqual(received, expectedDigest);
}

function owner(request: IncomingMessage): { tenantId: string; userId: string } | null {
  const tenantId = request.headers["x-lpbot-tenant-id"];
  const userId = request.headers["x-lpbot-user-id"];
  return typeof tenantId === "string" &&
    identityPattern.test(tenantId) &&
    typeof userId === "string" &&
    uuidPattern.test(userId)
    ? { tenantId, userId: userId.toLowerCase() }
    : null;
}

function reauthenticatedSessionId(request: IncomingMessage): string | null {
  const value = request.headers["x-lpbot-reauthenticated-session-id"];
  return typeof value === "string" && uuidPattern.test(value) ? value.toLowerCase() : null;
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of request) {
      const bytes = Buffer.isBuffer(chunk) ? Buffer.from(chunk) : Buffer.from(chunk as Uint8Array);
      size += bytes.length;
      if (size > bodyLimit) {
        bytes.fill(0);
        throw new SignerError("REQUEST_TOO_LARGE");
      }
      chunks.push(bytes);
    }
    return Buffer.concat(chunks);
  } finally {
    for (const chunk of chunks) chunk.fill(0);
  }
}

function send(response: ServerResponse, status: number, body: unknown): void {
  const serialized = JSON.stringify(body);
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(serialized),
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(serialized);
}

function failure(response: ServerResponse, error: unknown): void {
  const signerError = asSignerError(error);
  const status =
    signerError.code === "REQUEST_TOO_LARGE"
      ? 413
      : signerError.code === "INVALID_MODE" ||
          signerError.code === "INVALID_PRIVATE_KEY" ||
          signerError.code === "INVALID_WALLET"
        ? 400
        : signerError.code === "INVALID_CREDENTIALS"
          ? 401
          : signerError.code === "LOCKED_OUT"
            ? 429
            : signerError.code === "SECRET_VERSION_CONFLICT" ||
                signerError.code === "REVISION_CONFLICT" ||
                signerError.code === "PASSWORD_ALREADY_CONFIGURED" ||
                signerError.code === "PREVIEW_EXPIRED" ||
                signerError.code === "PREVIEW_CHANGED"
              ? 409
              : signerError.code === "WALLET_ADDRESS_EXISTS"
                ? 409
                : signerError.code === "WALLET_NOT_FOUND"
                  ? 404
                  : 503;
  send(response, status, {
    error: {
      code: signerError.code,
      retryable: signerError.retryable,
    },
    success: false,
  });
}

export function createSignerHttpServer(input: {
  apiToken: string;
  service: CustodySignerService;
}): Server {
  const expectedDigest = tokenDigest(input.apiToken);
  const activeImports = new Set<string>();
  const server = createServer(async (request, response) => {
    response.setHeader("Connection", "close");
    if (!authorized(request, expectedDigest)) {
      send(response, 401, { error: { code: "UNAUTHENTICATED", retryable: false }, success: false });
      return;
    }
    if (request.method === "GET" && request.url === "/health") {
      send(response, 200, {
        data: {
          capabilities: [
            "import",
            "generate",
            "seal",
            "open-verify",
            "password-reseal",
            "keystore-unlock",
            "keystore-auto-lock",
          ],
          ready: true,
        },
        success: true,
      });
      return;
    }
    const ownership = owner(request);
    if (!ownership) {
      send(response, 400, { error: { code: "INVALID_WALLET", retryable: false }, success: false });
      return;
    }
    let body: Buffer | null = null;
    let importAcquired = false;
    try {
      const sessionId = reauthenticatedSessionId(request);
      if (request.method === "GET" && request.url === "/v1/keystore/status") {
        if (!sessionId) throw new SignerError("INVALID_WALLET");
        const status = await input.service.keystoreStatus(ownership.userId, sessionId);
        send(response, 200, { data: status, success: true });
        return;
      }
      if (request.method === "POST" && request.url === "/v1/keystore/lock") {
        const status = await input.service.lockKeystore(ownership.userId);
        send(response, 200, { data: status, success: true });
        return;
      }
      if (request.method === "GET" && request.url === "/v1/keystore/reset-preview") {
        const preview = await input.service.createKeystoreResetPreview(ownership.userId);
        send(response, 200, { data: preview, success: true });
        return;
      }
      const secretKeystorePath =
        request.url === "/v1/keystore/unlock" ||
        request.url === "/v1/keystore/password" ||
        request.url === "/v1/keystore/reset" ||
        /^\/v1\/wallets\/[0-9a-f-]+\/encryption-mode$/iu.test(request.url ?? "");
      if (
        secretKeystorePath &&
        (request.method === "POST" || request.method === "PUT") &&
        request.headers["content-type"]?.split(";", 1)[0] !==
          "application/vnd.lpbot.keystore-secret+json"
      ) {
        send(response, 415, {
          error: { code: "UNSUPPORTED_MEDIA_TYPE", retryable: false },
          success: false,
        });
        return;
      }
      if (request.method === "POST" && request.url === "/v1/keystore/unlock") {
        if (!sessionId) throw new SignerError("INVALID_WALLET");
        body = await readBody(request);
        const status = await input.service.unlockKeystore({
          ingress: body,
          reauthenticatedSessionId: sessionId,
          userId: ownership.userId,
        });
        send(response, 200, { data: status, success: true });
        return;
      }
      if (
        (request.method === "POST" || request.method === "PUT") &&
        request.url === "/v1/keystore/password"
      ) {
        body = await readBody(request);
        const status =
          request.method === "POST"
            ? await input.service.createKeystorePassword({
                ingress: body,
                userId: ownership.userId,
              })
            : await input.service.changeKeystorePassword({
                ingress: body,
                userId: ownership.userId,
              });
        send(response, 200, { data: status, success: true });
        return;
      }
      if (request.method === "PATCH" && request.url === "/v1/keystore/auto-lock") {
        body = await readBody(request);
        const parsed = JSON.parse(body.toString("utf8")) as unknown;
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          throw new SignerError("INVALID_AUTO_LOCK");
        }
        const value = parsed as Record<string, unknown>;
        const status = await input.service.updateKeystoreAutoLock({
          expectedVersion: Number(value.expectedVersion),
          minutes: Number(value.minutes),
          userId: ownership.userId,
        });
        send(response, 200, { data: status, success: true });
        return;
      }
      if (request.method === "POST" && request.url === "/v1/keystore/reset") {
        body = await readBody(request);
        const status = await input.service.resetKeystore({
          ingress: body,
          userId: ownership.userId,
        });
        send(response, 202, { data: status, success: true });
        return;
      }
      const modeSwitch = /^\/v1\/wallets\/([0-9a-f-]+)\/encryption-mode$/iu.exec(request.url ?? "");
      if (request.method === "POST" && modeSwitch?.[1]) {
        body = await readBody(request);
        const wallet = await input.service.changeWalletEncryptionMode({
          ingress: body,
          ...ownership,
          walletId: modeSwitch[1].toLowerCase(),
        });
        send(response, 202, { data: wallet, success: true });
        return;
      }
      if (request.method === "POST" && request.url === "/v1/wallets/import") {
        if (
          request.headers["content-type"]?.split(";", 1)[0] !==
          "application/vnd.lpbot.wallet-secret+json"
        ) {
          send(response, 415, {
            error: { code: "UNSUPPORTED_MEDIA_TYPE", retryable: false },
            success: false,
          });
          return;
        }
        if (activeImports.has(ownership.userId)) {
          send(response, 409, {
            error: { code: "IMPORT_IN_PROGRESS", retryable: false },
            success: false,
          });
          return;
        }
        activeImports.add(ownership.userId);
        importAcquired = true;
        body = await readBody(request);
        const wallet = await input.service.importWallet({ ingress: body, ...ownership });
        send(response, 201, { data: wallet, success: true });
        return;
      }
      if (request.method === "POST" && request.url === "/v1/wallets/generate") {
        body = await readBody(request);
        const mediaType = request.headers["content-type"]?.split(";", 1)[0];
        if (mediaType === "application/vnd.lpbot.wallet-secret+json") {
          const wallet = await input.service.generateWallet({
            ingress: body,
            mode: "user-password",
            name: "secret-ingress",
            ...ownership,
          });
          send(response, 201, { data: wallet, success: true });
          return;
        }
        const parsed = JSON.parse(body.toString("utf8")) as unknown;
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          throw new SignerError("INVALID_WALLET");
        }
        const value = parsed as Record<string, unknown>;
        if (value.mode !== "server-kek" || typeof value.name !== "string") {
          throw new SignerError(value.mode === "server-kek" ? "INVALID_WALLET" : "INVALID_MODE");
        }
        const wallet = await input.service.generateWallet({
          mode: value.mode,
          name: value.name,
          ...ownership,
        });
        send(response, 201, { data: wallet, success: true });
        return;
      }
      const recovery = /^\/v1\/wallets\/([0-9a-f-]+)\/open-verify$/iu.exec(request.url ?? "");
      if (request.method === "POST" && recovery?.[1]) {
        const wallet = await input.service.recoverWallet({
          ...ownership,
          walletId: recovery[1].toLowerCase(),
        });
        send(response, 200, { data: wallet, success: true });
        return;
      }
      send(response, 404, { error: { code: "NOT_FOUND", retryable: false }, success: false });
    } catch (error) {
      failure(response, error);
    } finally {
      body?.fill(0);
      if (importAcquired) activeImports.delete(ownership.userId);
    }
  });
  server.headersTimeout = 5_000;
  server.requestTimeout = 10_000;
  server.keepAliveTimeout = 1_000;
  return server;
}
