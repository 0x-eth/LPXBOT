import { randomBytes } from "node:crypto";

import {
  LoginWalletAuthenticationService,
  type NewAuthWalletChallenge,
} from "../packages/security/src/index.js";
import { parseSiweMessage } from "viem/siwe";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it, vi } from "vitest";

describe("P01-04 login wallet authentication", () => {
  it("issues a canonical, purpose-bound SIWE challenge while persisting hashes only", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const persisted: NewAuthWalletChallenge[] = [];
    const store = {
      createAuthWalletChallenge: vi.fn(async (challenge: NewAuthWalletChallenge) => {
        persisted.push(challenge);
      }),
    };
    const now = new Date("2026-08-14T08:00:00.000Z");
    const service = new LoginWalletAuthenticationService(store, {
      challengeKey: randomBytes(32),
      challengeTtlSeconds: 300,
      domain: "lpbot.local",
      now: () => now,
      sessionTtlSeconds: 3_600,
      uri: "https://lpbot.local/login",
    });

    const challenge = await service.createLoginChallenge({
      address: account.address,
      chainId: 56,
      requestId: "req-wallet-nonce",
    });

    expect(challenge.nonceId).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(challenge.expiresAt).toEqual(new Date("2026-08-14T08:05:00.000Z"));
    expect(parseSiweMessage(challenge.message)).toMatchObject({
      address: account.address,
      chainId: 56,
      domain: "lpbot.local",
      expirationTime: new Date("2026-08-14T08:05:00.000Z"),
      issuedAt: now,
      resources: ["urn:lpbot:auth-purpose:login"],
      uri: "https://lpbot.local/login",
      version: "1",
    });

    expect(store.createAuthWalletChallenge).toHaveBeenCalledTimes(1);
    expect(persisted).toEqual([
      expect.objectContaining({
        address: account.address.toLowerCase(),
        chainId: 56,
        idHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
        messageHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
        nonceHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
        purpose: "login",
        userId: null,
      }),
    ]);
    const stored = JSON.stringify(persisted);
    const nonce = parseSiweMessage(challenge.message).nonce;
    expect(stored).not.toContain(challenge.nonceId);
    expect(stored).not.toContain(challenge.message);
    expect(stored).not.toContain(nonce);
    expect(stored).not.toContain(generatePrivateKey());
  });
});
