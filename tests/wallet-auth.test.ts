import { randomBytes } from "node:crypto";

import {
  LoginWalletAuthenticationService,
  type AccessAuditEvent,
  type ConsumeAuthWalletLoginInput,
  type ConsumeAuthWalletLinkInput,
  type NewAuthWalletChallenge,
  type NewStoredSession,
  type StoredAccount,
  type StoredAuthWalletChallenge,
  type StoredLoginWalletLink,
  type StoredSession,
} from "../packages/security/src/index.js";
import { parseSiweMessage } from "viem/siwe";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it, vi } from "vitest";

class MemoryLoginWalletStore {
  readonly account: StoredAccount = {
    allowedChainIds: [56],
    avatarUrl: null,
    displayName: "Wallet User",
    id: "00000000-0000-4000-8000-000000000040",
    role: "user",
    status: "active",
    tier: "normal",
  };
  readonly audits: AccessAuditEvent[] = [];
  readonly challenges: StoredAuthWalletChallenge[] = [];
  readonly links: StoredLoginWalletLink[] = [];
  readonly sessions = new Map<string, StoredSession>();

  async consumeAuthWalletLogin(
    input: ConsumeAuthWalletLoginInput,
  ): Promise<{ account: StoredAccount | null; status: "consumed" | "replayed" }> {
    const challenge = this.challenges.find(({ idHash }) => idHash === input.idHash);
    if (!challenge || challenge.consumedAt) return { account: null, status: "replayed" };
    challenge.consumedAt = input.consumedAt;
    return { account: this.account, status: "consumed" };
  }

  async createAuthWalletChallenge(challenge: NewAuthWalletChallenge): Promise<void> {
    this.challenges.push({ ...challenge, consumedAt: null });
  }

  async createSession(session: NewStoredSession): Promise<void> {
    this.sessions.set(session.tokenHash, {
      ...session,
      account: this.account,
      lastSeenAt: null,
      revokedAt: null,
    });
  }

  async consumeAuthWalletLink(input: ConsumeAuthWalletLinkInput) {
    const challenge = this.challenges.find(({ idHash }) => idHash === input.idHash);
    if (!challenge || challenge.consumedAt) return { link: null, status: "replayed" as const };
    if (this.links.some(({ address }) => address === input.address)) {
      return { link: null, status: "already-linked" as const };
    }
    challenge.consumedAt = input.consumedAt;
    const link: StoredLoginWalletLink = {
      address: input.address,
      createdAt: input.consumedAt,
      id: input.linkId,
      label: input.label,
      updatedAt: input.consumedAt,
      userId: input.userId,
    };
    this.links.push(link);
    return { link, status: "consumed" as const };
  }

  async findAuthWalletChallenge(idHash: string): Promise<StoredAuthWalletChallenge | null> {
    return this.challenges.find((challenge) => challenge.idHash === idHash) ?? null;
  }

  async findSessionByTokenHash(tokenHash: string): Promise<StoredSession | null> {
    return this.sessions.get(tokenHash) ?? null;
  }

  async findLoginWalletByAddress(address: string): Promise<StoredLoginWalletLink | null> {
    return this.links.find((link) => link.address === address) ?? null;
  }

  async listLoginWalletLinks(userId: string): Promise<StoredLoginWalletLink[]> {
    return this.links.filter((link) => link.userId === userId);
  }

  async recordAccessAudit(event: AccessAuditEvent): Promise<void> {
    this.audits.push(event);
  }

  async revokeSession(): Promise<boolean> {
    return false;
  }

  async touchSession(): Promise<void> {}

  async deleteOwnedLoginWalletLink() {
    return "not-found" as const;
  }
}

function authenticationService(store: MemoryLoginWalletStore, now: () => Date) {
  return new LoginWalletAuthenticationService(store, {
    challengeKey: randomBytes(32),
    challengeTtlSeconds: 300,
    domain: "lpbot.local",
    now,
    sessionTtlSeconds: 3_600,
    uri: "https://lpbot.local/login",
  });
}

describe("P01-04 login wallet authentication", () => {
  it("issues a canonical, purpose-bound SIWE challenge while persisting hashes only", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const store = new MemoryLoginWalletStore();
    const createChallenge = vi.spyOn(store, "createAuthWalletChallenge");
    const now = new Date("2026-08-14T08:00:00.000Z");
    const service = authenticationService(store, () => now);

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

    expect(createChallenge).toHaveBeenCalledTimes(1);
    expect(store.challenges).toEqual([
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
    const stored = JSON.stringify(store.challenges);
    const nonce = parseSiweMessage(challenge.message).nonce;
    expect(stored).not.toContain(challenge.nonceId);
    expect(stored).not.toContain(challenge.message);
    expect(stored).not.toContain(nonce);
    expect(stored).not.toContain(generatePrivateKey());
  });

  it("verifies an EOA signature, consumes the challenge once and issues a hashed session", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const now = new Date("2026-08-14T08:10:00.000Z");
    const store = new MemoryLoginWalletStore();
    const service = authenticationService(store, () => now);
    const challenge = await service.createLoginChallenge({
      address: account.address,
      chainId: 56,
      requestId: "req-wallet-nonce-valid",
    });
    const signature = await account.signMessage({ message: challenge.message });

    const result = await service.login({
      address: account.address,
      chainId: 56,
      nonceId: challenge.nonceId,
      requestId: "req-wallet-login-valid",
      signature,
    });

    expect(result.account).toEqual(store.account);
    expect(result.session.token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(store.challenges[0]?.consumedAt).toEqual(now);
    expect([...store.sessions.keys()]).toEqual([expect.stringMatching(/^[a-f0-9]{64}$/u)]);
    expect(JSON.stringify([...store.sessions.values()])).not.toContain(result.session.token);
    expect(store.audits.at(-1)).toMatchObject({
      action: "wallet.login",
      outcome: "allowed",
      requestId: "req-wallet-login-valid",
      sessionId: result.session.sessionId,
      userId: store.account.id,
    });
  });

  it("issues a link challenge bound to the authenticated user and link purpose", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const now = new Date("2026-08-14T08:20:00.000Z");
    const store = new MemoryLoginWalletStore();
    const service = authenticationService(store, () => now);

    const challenge = await service.createLinkChallenge({
      address: account.address,
      chainId: 56,
      requestId: "req-wallet-link-nonce",
      userId: store.account.id,
    });

    expect(parseSiweMessage(challenge.message)).toMatchObject({
      address: account.address,
      chainId: 56,
      resources: [
        "urn:lpbot:auth-purpose:link",
        `urn:lpbot:auth-user:${store.account.id}`,
      ],
    });
    expect(store.challenges.at(-1)).toMatchObject({
      address: account.address.toLowerCase(),
      purpose: "link",
      userId: store.account.id,
    });
    expect(JSON.stringify(store.challenges)).not.toContain(challenge.nonceId);
    expect(JSON.stringify(store.challenges)).not.toContain(challenge.message);
  });
});
