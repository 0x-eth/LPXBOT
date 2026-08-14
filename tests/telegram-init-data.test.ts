import { createHmac } from "node:crypto";

import {
  TelegramInitDataError,
  TelegramInitDataVerifier,
} from "../packages/security/src/telegram-init-data.js";
import { describe, expect, it } from "vitest";

const fixtureToken = "123456789:LOCAL_FIXTURE_TELEGRAM_TOKEN";
const now = new Date("2026-08-14T03:00:00.000Z");

function signInitData(
  fields: Readonly<Record<string, string>>,
  token = fixtureToken,
): string {
  const dataCheckString = Object.entries(fields)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  const hash = createHmac("sha256", secret).update(dataCheckString).digest("hex");
  return `${new URLSearchParams(fields).toString()}&hash=${hash}`;
}

function currentFixture(overrides: Readonly<Record<string, string>> = {}): string {
  return signInitData({
    auth_date: String(Math.floor(now.getTime() / 1_000)),
    query_id: "LOCAL_QUERY",
    user: JSON.stringify({ first_name: "Fixture", id: 279_058_397 }),
    ...overrides,
  });
}

function verifier(at = now): TelegramInitDataVerifier {
  return new TelegramInitDataVerifier({
    botToken: fixtureToken,
    maxAgeSeconds: 300,
    maxFutureSkewSeconds: 30,
    now: () => at,
  });
}

function expectCode(run: () => unknown, code: TelegramInitDataError["code"]): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(TelegramInitDataError);
    expect((error as TelegramInitDataError).code).toBe(code);
    return;
  }
  throw new Error(`Expected ${code}`);
}

describe("Telegram Mini App initData verifier", () => {
  it("accepts Telegram's independently published HMAC test vector", () => {
    // Telegram documentation publishes this inactive sample as two token components.
    const documentationToken = [
      "5768337691",
      "AAH5YkoiEuPk8-FZa32hStHTqXiLPtAEhx8",
    ].join(":");
    const initData =
      "query_id=AAHdF6IQAAAAAN0XohDhrOrc" +
      "&user=%7B%22id%22%3A279058397%2C%22first_name%22%3A%22Vladislav%22%2C%22last_name%22%3A%22Kibenko%22%2C%22username%22%3A%22vdkfrost%22%2C%22language_code%22%3A%22ru%22%2C%22is_premium%22%3Atrue%7D" +
      "&auth_date=1662771648" +
      "&hash=c501b71e775f74ce10e377dea85a7ea24ecd640b223ea86dfe453e0eaed2e2b2";

    const result = new TelegramInitDataVerifier({
      botToken: documentationToken,
      maxAgeSeconds: 300,
      maxFutureSkewSeconds: 30,
      now: () => new Date("2022-09-10T01:02:00.000Z"),
    }).verify(initData);

    expect(result).toMatchObject({
      authDate: new Date("2022-09-10T01:00:48.000Z"),
      subject: "279058397",
    });
    expect(result.replayDigest).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("accepts a valid current fixture and returns only identity metadata plus a digest", () => {
    expect(verifier().verify(currentFixture())).toEqual({
      authDate: now,
      replayDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
      subject: "279058397",
    });
  });

  it("uses one replay digest for equivalent parameter order and encoding", () => {
    const original = currentFixture();
    const reordered = [...new URLSearchParams(original).entries()]
      .reverse()
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .join("&");

    expect(verifier().verify(reordered).replayDigest).toBe(
      verifier().verify(original).replayDigest,
    );
  });

  it("rejects a tampered signature", () => {
    const tampered = currentFixture().replace("Fixture", "Changed");
    expectCode(() => verifier().verify(tampered), "AUTH_INVALID");
  });

  it("rejects expired and implausibly future auth_date values", () => {
    expectCode(
      () => verifier(new Date(now.getTime() + 301_000)).verify(currentFixture()),
      "AUTH_EXPIRED",
    );
    expectCode(
      () => verifier(new Date(now.getTime() - 31_000)).verify(currentFixture()),
      "AUTH_FUTURE",
    );
  });

  it.each(["auth_date", "hash", "user"])("rejects a missing %s field", (field) => {
    const entries = {
      auth_date: String(Math.floor(now.getTime() / 1_000)),
      query_id: "LOCAL_QUERY",
      user: JSON.stringify({ first_name: "Fixture", id: 279_058_397 }),
    };
    if (field === "hash") {
      expectCode(
        () => verifier().verify(new URLSearchParams(entries).toString()),
        "AUTH_INVALID",
      );
      return;
    }
    delete entries[field as keyof typeof entries];
    expectCode(() => verifier().verify(signInitData(entries)), "AUTH_INVALID");
  });

  it.each(["auth_date", "hash", "user", "query_id"])(
    "rejects a repeated %s field before library validation",
    (field) => {
      const valid = currentFixture();
      const value = new URLSearchParams(valid).get(field);
      expect(value).not.toBeNull();
      expectCode(
        () => verifier().verify(`${valid}&${field}=${encodeURIComponent(value ?? "")}`),
        "AUTH_DUPLICATE_FIELD",
      );
    },
  );
});
