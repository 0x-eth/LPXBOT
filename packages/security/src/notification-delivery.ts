import { createHash, createHmac } from "node:crypto";

export const notificationTemplateVariables = [
  "delivery.id",
  "delivery.timestamp",
  "monitor.id",
  "monitor.name",
  "monitor.revision",
  "pool.key",
  "pool.token0",
  "pool.token1",
  "window.end",
  "metric.version",
  "condition.summary",
  "metrics.volumeUsd",
  "metrics.feesUsd",
  "metrics.feeTvlRatio",
  "metrics.tvlUsd",
  "metrics.transactionCount",
] as const;

export type NotificationTemplateVariable = (typeof notificationTemplateVariables)[number];
export type NotificationTemplateMethod = "GET" | "POST" | "TELEGRAM";
export type NotificationTemplateValues = Readonly<Record<string, string>>;

export type NotificationTemplateErrorCode =
  | "BODY_TOO_LARGE"
  | "INVALID_TEMPLATE"
  | "INVALID_TEMPLATE_LOCATION"
  | "MISSING_TEMPLATE_VARIABLE"
  | "TELEGRAM_MESSAGE_TOO_LARGE"
  | "TEMPLATE_TOO_LARGE"
  | "UNKNOWN_TEMPLATE_VARIABLE"
  | "URL_TOO_LARGE";

export class NotificationTemplateError extends Error {
  readonly code: NotificationTemplateErrorCode;

  constructor(code: NotificationTemplateErrorCode) {
    super(code);
    this.name = "NotificationTemplateError";
    this.code = code;
  }
}

interface GetTemplatePart {
  name: string;
  value: string;
}

type JsonTemplate =
  null | boolean | number | string | JsonTemplate[] | { [key: string]: JsonTemplate };

export type CompiledNotificationTemplate =
  | { method: "GET"; parts: readonly GetTemplatePart[]; source: string }
  | { method: "POST"; source: string; value: JsonTemplate }
  | { method: "TELEGRAM"; source: string; value: string };

const allowedVariables = new Set<string>(notificationTemplateVariables);
const placeholderPattern = /\{\{([^{}]+)\}\}/gu;
const controlCharacterPattern = /[\u0000-\u001f\u007f]/u;

function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function templateSource(method: NotificationTemplateMethod, input: unknown): string {
  if (method === "POST") {
    if (typeof input === "string") return input;
    try {
      const serialized = JSON.stringify(input);
      if (serialized === undefined) throw new TypeError("not JSON");
      return serialized;
    } catch {
      throw new NotificationTemplateError("INVALID_TEMPLATE");
    }
  }
  if (typeof input !== "string") throw new NotificationTemplateError("INVALID_TEMPLATE");
  return input;
}

function assertTemplateSize(source: string): void {
  if (utf8Bytes(source) > 16_384) {
    throw new NotificationTemplateError("TEMPLATE_TOO_LARGE");
  }
}

function variablesIn(value: string): string[] {
  const variables: string[] = [];
  for (const match of value.matchAll(placeholderPattern)) variables.push(match[1]!);
  const withoutPlaceholders = value.replace(placeholderPattern, "");
  if (withoutPlaceholders.includes("{{") || withoutPlaceholders.includes("}}")) {
    throw new NotificationTemplateError("INVALID_TEMPLATE");
  }
  for (const variable of variables) {
    if (!allowedVariables.has(variable)) {
      throw new NotificationTemplateError("UNKNOWN_TEMPLATE_VARIABLE");
    }
  }
  return variables;
}

function assertJsonTemplate(value: unknown): asserts value is JsonTemplate {
  if (value === null || typeof value === "boolean" || typeof value === "number") return;
  if (typeof value === "string") {
    variablesIn(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assertJsonTemplate(item);
    return;
  }
  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (variablesIn(key).length > 0) {
        throw new NotificationTemplateError("INVALID_TEMPLATE_LOCATION");
      }
      assertJsonTemplate(child);
    }
    return;
  }
  throw new NotificationTemplateError("INVALID_TEMPLATE");
}

export function compileNotificationTemplate(
  method: NotificationTemplateMethod,
  input: unknown,
): CompiledNotificationTemplate {
  const source = templateSource(method, input);
  assertTemplateSize(source);

  if (method === "GET") {
    if (source === "" || controlCharacterPattern.test(source)) {
      throw new NotificationTemplateError("INVALID_TEMPLATE");
    }
    const parts = source.split("&").map((part) => {
      const separator = part.indexOf("=");
      if (separator <= 0) throw new NotificationTemplateError("INVALID_TEMPLATE");
      const name = part.slice(0, separator);
      const value = part.slice(separator + 1);
      if (variablesIn(name).length > 0) {
        throw new NotificationTemplateError("INVALID_TEMPLATE_LOCATION");
      }
      variablesIn(value);
      return { name, value };
    });
    return { method, parts, source };
  }

  if (method === "TELEGRAM") {
    if (controlCharacterPattern.test(source)) {
      throw new NotificationTemplateError("INVALID_TEMPLATE");
    }
    variablesIn(source);
    return { method, source, value: source };
  }

  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch {
    throw new NotificationTemplateError("INVALID_TEMPLATE");
  }
  assertJsonTemplate(value);
  return { method, source, value };
}

function substitute(
  template: string,
  values: NotificationTemplateValues,
  escape: (value: string) => string = (value) => value,
): string {
  return template.replace(placeholderPattern, (_placeholder, variable: string) => {
    if (!Object.hasOwn(values, variable) || typeof values[variable] !== "string") {
      throw new NotificationTemplateError("MISSING_TEMPLATE_VARIABLE");
    }
    return escape(values[variable]);
  });
}

function rfc3986Encode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/gu,
    (character) => `%${character.codePointAt(0)!.toString(16).toUpperCase()}`,
  );
}

export function renderGetWebhook(
  template: CompiledNotificationTemplate,
  values: NotificationTemplateValues,
  options: { baseUrl?: string } = {},
): { body: ""; query: string; url: string; urlBytes: number } {
  if (template.method !== "GET") throw new NotificationTemplateError("INVALID_TEMPLATE");
  const query = template.parts
    .map(({ name, value }) => `${name}=${rfc3986Encode(substitute(value, values))}`)
    .join("&");
  const baseUrl = options.baseUrl ?? "";
  const url = baseUrl === "" ? query : `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}${query}`;
  const urlBytes = utf8Bytes(url);
  if (urlBytes > 4_096) throw new NotificationTemplateError("URL_TOO_LARGE");
  return { body: "", query, url, urlBytes };
}

function renderJsonValue(value: JsonTemplate, values: NotificationTemplateValues): JsonTemplate {
  if (typeof value === "string") return substitute(value, values);
  if (Array.isArray(value)) return value.map((child) => renderJsonValue(child, values));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, renderJsonValue(child, values)]),
    );
  }
  return value;
}

export function renderPostWebhook(
  template: CompiledNotificationTemplate,
  values: NotificationTemplateValues,
): { body: string; bodyBytes: number } {
  if (template.method !== "POST") throw new NotificationTemplateError("INVALID_TEMPLATE");
  const body = JSON.stringify(renderJsonValue(template.value, values));
  const bodyBytes = utf8Bytes(body);
  if (bodyBytes > 65_536) throw new NotificationTemplateError("BODY_TOO_LARGE");
  return { body, bodyBytes };
}

function telegramHtmlEscape(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function renderTelegramMessage(
  template: CompiledNotificationTemplate,
  values: NotificationTemplateValues,
): { codePoints: number; message: string } {
  if (template.method !== "TELEGRAM") throw new NotificationTemplateError("INVALID_TEMPLATE");
  const message = substitute(template.value, values, telegramHtmlEscape);
  const codePoints = [...message].length;
  if (codePoints > 4_096) {
    throw new NotificationTemplateError("TELEGRAM_MESSAGE_TOO_LARGE");
  }
  return { codePoints, message };
}

export function buildWebhookSignature(input: {
  body: string;
  deliveryId: string;
  fixtureKey: string;
  method: "GET" | "POST";
  pathAndQuery: string;
  timestamp: string;
}): { bodySha256: string; canonicalInput: string; value: string } {
  const bodySha256 = createHash("sha256").update(input.body, "utf8").digest("hex");
  const canonicalInput = [
    "v1",
    input.timestamp,
    input.deliveryId,
    input.method.toUpperCase(),
    input.pathAndQuery,
    bodySha256,
  ].join("\n");
  const digest = createHmac("sha256", input.fixtureKey)
    .update(canonicalInput, "utf8")
    .digest("hex");
  return { bodySha256, canonicalInput, value: `v1=${digest}` };
}
