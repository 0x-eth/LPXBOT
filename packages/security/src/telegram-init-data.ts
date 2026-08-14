import { createHash } from "node:crypto";

import { parse, validate } from "@tma.js/init-data-node";

export type TelegramInitDataErrorCode =
  "AUTH_DUPLICATE_FIELD" | "AUTH_EXPIRED" | "AUTH_FUTURE" | "AUTH_INVALID";

export class TelegramInitDataError extends Error {
  readonly code: TelegramInitDataErrorCode;

  constructor(code: TelegramInitDataErrorCode) {
    super(code);
    this.name = "TelegramInitDataError";
    this.code = code;
  }
}

export interface VerifiedTelegramInitData {
  authDate: Date;
  replayDigest: string;
  subject: string;
}

export interface TelegramInitDataVerifierOptions {
  botToken: string;
  maxAgeSeconds: number;
  maxFutureSkewSeconds: number;
  now?: () => Date;
}

const requiredFields = ["auth_date", "hash", "user"] as const;

export class TelegramInitDataVerifier {
  readonly #botToken: string;
  readonly #maxAgeMilliseconds: number;
  readonly #maxFutureSkewMilliseconds: number;
  readonly #now: () => Date;

  constructor(options: TelegramInitDataVerifierOptions) {
    if (options.botToken.trim() === "") {
      throw new TypeError("Telegram Bot token is required");
    }
    if (!Number.isSafeInteger(options.maxAgeSeconds) || options.maxAgeSeconds <= 0) {
      throw new RangeError("Telegram initData max age must be a positive integer");
    }
    if (!Number.isSafeInteger(options.maxFutureSkewSeconds) || options.maxFutureSkewSeconds < 0) {
      throw new RangeError("Telegram future clock skew must be a non-negative integer");
    }

    this.#botToken = options.botToken;
    this.#maxAgeMilliseconds = options.maxAgeSeconds * 1_000;
    this.#maxFutureSkewMilliseconds = options.maxFutureSkewSeconds * 1_000;
    this.#now = options.now ?? (() => new Date());
  }

  verifyRequestBody(body: unknown): VerifiedTelegramInitData {
    if (typeof body !== "object" || body === null || !("initData" in body)) {
      throw new TelegramInitDataError("AUTH_INVALID");
    }
    const initData = (body as { initData?: unknown }).initData;
    if (typeof initData !== "string") {
      throw new TelegramInitDataError("AUTH_INVALID");
    }
    return this.verify(initData);
  }

  verify(initData: string): VerifiedTelegramInitData {
    if (typeof initData !== "string" || initData.length === 0) {
      throw new TelegramInitDataError("AUTH_INVALID");
    }

    const parameters = new URLSearchParams(initData);
    const names = new Set<string>();
    for (const name of parameters.keys()) {
      if (names.has(name)) {
        throw new TelegramInitDataError("AUTH_DUPLICATE_FIELD");
      }
      names.add(name);
    }
    if (requiredFields.some((field) => !names.has(field))) {
      throw new TelegramInitDataError("AUTH_INVALID");
    }

    let parsed: ReturnType<typeof parse>;
    try {
      validate(initData, this.#botToken, { expiresIn: 0 });
      const parseParameters = new URLSearchParams(parameters);
      if (!parseParameters.has("signature")) parseParameters.set("signature", "");
      parsed = parse(parseParameters);
    } catch {
      throw new TelegramInitDataError("AUTH_INVALID");
    }

    const subject = parsed.user?.id;
    if (!Number.isSafeInteger(subject) || (subject ?? 0) <= 0) {
      throw new TelegramInitDataError("AUTH_INVALID");
    }

    const authDate = parsed.auth_date;
    const now = this.#now();
    const ageMilliseconds = now.getTime() - authDate.getTime();
    if (ageMilliseconds < -this.#maxFutureSkewMilliseconds) {
      throw new TelegramInitDataError("AUTH_FUTURE");
    }
    if (ageMilliseconds > this.#maxAgeMilliseconds) {
      throw new TelegramInitDataError("AUTH_EXPIRED");
    }

    const replayParameters = new URLSearchParams(parameters);
    replayParameters.sort();

    return {
      authDate,
      replayDigest: createHash("sha256").update(replayParameters.toString(), "utf8").digest("hex"),
      subject: String(subject),
    };
  }
}
