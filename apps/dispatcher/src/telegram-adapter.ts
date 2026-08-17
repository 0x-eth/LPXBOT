import {
  compileNotificationTemplate,
  NotificationTemplateError,
  renderTelegramMessage,
  type NotificationTemplateValues,
} from "@lpbot/security";
import https from "node:https";

export type TelegramTransportErrorCode =
  | "TELEGRAM_CONNECT_TIMEOUT"
  | "TELEGRAM_CONNECTION_RESET"
  | "TELEGRAM_FIRST_BYTE_TIMEOUT"
  | "TELEGRAM_RESPONSE_TOO_LARGE"
  | "TELEGRAM_TOTAL_TIMEOUT";

export class TelegramTransportError extends Error {
  readonly code: TelegramTransportErrorCode;

  constructor(code: TelegramTransportErrorCode) {
    super(code);
    this.name = "TelegramTransportError";
    this.code = code;
  }
}

export interface TelegramIdentityOwnershipStore {
  owns(userId: string, telegramIdentityId: string): Promise<boolean>;
}

export interface TelegramTransportRequest {
  botToken: string;
  chatId: string;
  deliveryId: string;
  parseMode: "HTML";
  signal: AbortSignal;
  text: string;
}

export interface TelegramTransportResponse {
  body: unknown;
  status: number;
}

export interface TelegramTransport {
  send(request: TelegramTransportRequest): Promise<TelegramTransportResponse>;
}

export class NodeTelegramTransport implements TelegramTransport {
  async send(input: TelegramTransportRequest): Promise<TelegramTransportResponse> {
    const body = JSON.stringify({
      chat_id: input.chatId,
      parse_mode: input.parseMode,
      text: input.text,
    });
    return await new Promise<TelegramTransportResponse>((resolve, reject) => {
      let settled = false;
      const chunks: Buffer[] = [];
      let bytes = 0;
      const finish = (error?: TelegramTransportError, response?: TelegramTransportResponse) => {
        if (settled) return;
        settled = true;
        clearTimeout(totalTimer);
        clearTimeout(firstByteTimer);
        input.signal.removeEventListener("abort", abort);
        if (error) reject(error);
        else resolve(response!);
      };
      const request = https.request(
        {
          agent: false,
          headers: {
            "content-length": Buffer.byteLength(body).toString(),
            "content-type": "application/json; charset=utf-8",
            "x-lpx-delivery-id": input.deliveryId,
          },
          hostname: "api.telegram.org",
          method: "POST",
          minVersion: "TLSv1.2",
          path: `/bot${encodeURIComponent(input.botToken)}/sendMessage`,
          rejectUnauthorized: true,
          servername: "api.telegram.org",
        },
        (response) => {
          clearTimeout(firstByteTimer);
          response.on("data", (chunk: Buffer) => {
            bytes += chunk.byteLength;
            if (bytes > 65_536) {
              request.destroy();
              finish(new TelegramTransportError("TELEGRAM_RESPONSE_TOO_LARGE"));
              return;
            }
            chunks.push(chunk);
          });
          response.once("end", () => {
            let parsed: unknown = null;
            try {
              parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
            } catch {
              // Invalid provider JSON is classified from the HTTP status by the adapter.
            }
            finish(undefined, { body: parsed, status: response.statusCode ?? 0 });
          });
          response.once("error", () =>
            finish(new TelegramTransportError("TELEGRAM_CONNECTION_RESET")),
          );
        },
      );
      const abort = () => {
        request.destroy();
        finish(new TelegramTransportError("TELEGRAM_TOTAL_TIMEOUT"));
      };
      input.signal.addEventListener("abort", abort, { once: true });
      request.once("error", () =>
        finish(new TelegramTransportError("TELEGRAM_CONNECTION_RESET")),
      );
      const firstByteTimer = setTimeout(
        () => finish(new TelegramTransportError("TELEGRAM_FIRST_BYTE_TIMEOUT")),
        5_000,
      );
      firstByteTimer.unref?.();
      const totalTimer = setTimeout(
        () => finish(new TelegramTransportError("TELEGRAM_TOTAL_TIMEOUT")),
        10_000,
      );
      totalTimer.unref?.();
      request.end(body);
    });
  }
}

export interface TelegramDeliveryInput {
  config: { telegramIdentityId: string; template: string };
  deliveryId: string;
  secret: string;
  signal?: AbortSignal;
  userId: string;
  values: NotificationTemplateValues;
}

export type TelegramDeliveryResult =
  | { acknowledgement: string; status: "delivered" }
  | { errorCode: string; retryAfterSeconds?: number; status: "retry" }
  | { errorCode: string; status: "dead" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function retryAfter(body: unknown): number | undefined {
  if (!isRecord(body) || !isRecord(body.parameters)) return undefined;
  const seconds = body.parameters.retry_after;
  return Number.isSafeInteger(seconds) && (seconds as number) > 0
    ? Math.min(seconds as number, 3_600)
    : undefined;
}

function providerAcknowledgement(body: unknown): string {
  const raw =
    isRecord(body) && isRecord(body.result) &&
    (typeof body.result.message_id === "string" || typeof body.result.message_id === "number")
      ? String(body.result.message_id)
      : "accepted";
  return `telegram:${[...raw].slice(0, 110).join("")}`;
}

function classify(response: TelegramTransportResponse): TelegramDeliveryResult {
  const providerCode =
    isRecord(response.body) && Number.isSafeInteger(response.body.error_code)
      ? (response.body.error_code as number)
      : response.status;
  const succeeded =
    response.status >= 200 &&
    response.status <= 299 &&
    (!isRecord(response.body) || response.body.ok !== false);
  if (succeeded) {
    return { acknowledgement: providerAcknowledgement(response.body), status: "delivered" };
  }
  if (response.status === 429 || providerCode === 429) {
    const seconds = retryAfter(response.body);
    return {
      errorCode: "TELEGRAM_RATE_LIMITED",
      ...(seconds === undefined ? {} : { retryAfterSeconds: seconds }),
      status: "retry",
    };
  }
  if (response.status >= 500 || providerCode >= 500) {
    return { errorCode: "TELEGRAM_PROVIDER_UNAVAILABLE", status: "retry" };
  }
  if (response.status === 401 || providerCode === 401) {
    return { errorCode: "TELEGRAM_AUTHENTICATION_FAILED", status: "dead" };
  }
  if (response.status === 403 || providerCode === 403) {
    return { errorCode: "TELEGRAM_PERMISSION_DENIED", status: "dead" };
  }
  return { errorCode: "TELEGRAM_FORMAT_INVALID", status: "dead" };
}

export class TelegramDeliveryAdapter {
  readonly #identities: TelegramIdentityOwnershipStore;
  readonly #transport: TelegramTransport;

  constructor(options: {
    identities: TelegramIdentityOwnershipStore;
    transport: TelegramTransport;
  }) {
    this.#identities = options.identities;
    this.#transport = options.transport;
  }

  async deliver(input: TelegramDeliveryInput): Promise<TelegramDeliveryResult> {
    let owned: boolean;
    try {
      owned = await this.#identities.owns(input.userId, input.config.telegramIdentityId);
    } catch {
      return { errorCode: "TELEGRAM_IDENTITY_CHECK_FAILED", status: "retry" };
    }
    if (!owned) return { errorCode: "TELEGRAM_IDENTITY_NOT_OWNED", status: "dead" };
    let text: string;
    try {
      const template = compileNotificationTemplate("TELEGRAM", input.config.template);
      text = renderTelegramMessage(template, input.values).message;
    } catch (error) {
      if (error instanceof NotificationTemplateError) {
        return { errorCode: error.code, status: "dead" };
      }
      return { errorCode: "TELEGRAM_FORMAT_INVALID", status: "dead" };
    }
    try {
      const response = await this.#transport.send({
        botToken: input.secret,
        chatId: input.config.telegramIdentityId,
        deliveryId: input.deliveryId,
        parseMode: "HTML",
        signal: input.signal ?? new AbortController().signal,
        text,
      });
      return classify(response);
    } catch (error) {
      return {
        errorCode:
          error instanceof TelegramTransportError ? error.code : "TELEGRAM_NETWORK_ERROR",
        status: "retry",
      };
    }
  }
}
