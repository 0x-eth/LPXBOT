import { randomBytes } from "node:crypto";

import { createLoginWalletAuthenticationFromEnvironment } from "../apps/api/src/index.js";
import type { LoginWalletAuthStore } from "../packages/security/src/index.js";
import { describe, expect, it } from "vitest";

const unusedStore = {} as LoginWalletAuthStore;

describe("P01-04 login wallet environment configuration", () => {
  it("stays disabled without an explicit challenge key", () => {
    expect(createLoginWalletAuthenticationFromEnvironment(unusedStore, {})).toBeNull();
  });

  it("accepts an explicit 32-byte key and rejects weak or malformed key material", () => {
    const configured = createLoginWalletAuthenticationFromEnvironment(unusedStore, {
      AUTH_SESSION_TTL_SECONDS: "3600",
      WALLET_AUTH_CHALLENGE_KEY_BASE64: randomBytes(32).toString("base64"),
      WALLET_AUTH_CHALLENGE_TTL_SECONDS: "300",
      WALLET_AUTH_DOMAIN: "lpbot.local",
      WALLET_AUTH_URI: "https://lpbot.local/login",
    });
    expect(configured).not.toBeNull();
    expect(configured).toEqual(
      expect.objectContaining({
        createLoginChallenge: expect.any(Function),
        login: expect.any(Function),
      }),
    );

    expect(() =>
      createLoginWalletAuthenticationFromEnvironment(unusedStore, {
        WALLET_AUTH_CHALLENGE_KEY_BASE64: Buffer.from("weak").toString("base64"),
        WALLET_AUTH_DOMAIN: "lpbot.local",
        WALLET_AUTH_URI: "https://lpbot.local/login",
      }),
    ).toThrow(/exactly 32 bytes/u);
  });
});
