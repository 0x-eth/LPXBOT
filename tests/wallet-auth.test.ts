import { randomBytes } from "node:crypto";

import {
  LoginWalletAuthenticationService,
  type AccessAuditEvent,
  type ConsumeAuthWalletLoginInput,
  type ConsumeAuthWalletLinkInput,
  type DeleteOwnedLoginWalletLinkInput,
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
  hasTelegramIdentity = false;
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

  async deleteOwnedLoginWalletLink(input: DeleteOwnedLoginWalletLinkInput) {
    const index = this.links.findIndex(
      (link) => link.id === input.linkId && link.userId === input.userId,
    );
    if (index < 0) return "not-found" as const;
    const loginWalletCount = this.links.filter((link) => link.userId === input.userId).length;
    if (!this.hasTelegramIdentity && loginWalletCount <= 1) return "last-method" as const;
    this.links.splice(index, 1);
    return "deleted" as const;
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

  it("verifies a link signature and returns only a masked login-wallet view", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const now = new Date("2026-08-14T08:30:00.000Z");
    const store = new MemoryLoginWalletStore();
    const service = authenticationService(store, () => now);
    const challenge = await service.createLinkChallenge({
      address: account.address,
      chainId: 56,
      requestId: "req-wallet-link-nonce-valid",
      userId: store.account.id,
    });
    const signature = await account.signMessage({ message: challenge.message });

    const result = await service.link({
      address: account.address,
      chainId: 56,
      label: "  Treasury login  ",
      nonceId: challenge.nonceId,
      requestId: "req-wallet-link-valid",
      signature,
      userId: store.account.id,
    });

    expect(result).toEqual({
      addressMasked: `${account.address.toLowerCase().slice(0, 6)}...${account.address.toLowerCase().slice(-4)}`,
      createdAt: now,
      label: "Treasury login",
      linkId: expect.any(String),
      updatedAt: now,
    });
    expect(JSON.stringify(result)).not.toContain(account.address);
    expect(JSON.stringify(result)).not.toContain(signature);
    expect(store.links).toHaveLength(1);
    expect(store.audits.at(-1)).toMatchObject({
      action: "wallet.link.create",
      outcome: "allowed",
      requestId: "req-wallet-link-valid",
      userId: store.account.id,
    });
  });

  it("lists only the current user's login wallets as masked views", async () => {
    const now = new Date("2026-08-14T08:40:00.000Z");
    const store = new MemoryLoginWalletStore();
    store.links.push(
      {
        address: "0x1111111111111111111111111111111111111111",
        createdAt: now,
        id: "00000000-0000-4000-8000-000000000051",
        label: "Primary",
        updatedAt: now,
        userId: store.account.id,
      },
      {
        address: "0x2222222222222222222222222222222222222222",
        createdAt: now,
        id: "00000000-0000-4000-8000-000000000052",
        label: "Other user",
        updatedAt: now,
        userId: "00000000-0000-4000-8000-000000000099",
      },
    );
    const service = authenticationService(store, () => now);

    const links = await service.listLinks(store.account.id);

    expect(links).toEqual([
      {
        addressMasked: "0x1111...1111",
        createdAt: now,
        label: "Primary",
        linkId: "00000000-0000-4000-8000-000000000051",
        updatedAt: now,
      },
    ]);
    expect(JSON.stringify(links)).not.toContain("0x1111111111111111111111111111111111111111");
    expect(JSON.stringify(links)).not.toContain("Other user");
  });

  it("enforces ownership and last-login-method protection when unlinking", async () => {
    const now = new Date("2026-08-14T08:50:00.000Z");
    const store = new MemoryLoginWalletStore();
    const ownedLink: StoredLoginWalletLink = {
      address: "0x1111111111111111111111111111111111111111",
      createdAt: now,
      id: "00000000-0000-4000-8000-000000000061",
      label: null,
      updatedAt: now,
      userId: store.account.id,
    };
    store.links.push(ownedLink);
    const service = authenticationService(store, () => now);

    await expect(
      service.unlink({
        linkId: ownedLink.id,
        requestId: "req-wallet-unlink-last",
        userId: store.account.id,
      }),
    ).rejects.toMatchObject({ code: "LAST_LOGIN_METHOD" });
    await expect(
      service.unlink({
        linkId: ownedLink.id,
        requestId: "req-wallet-unlink-cross-user",
        userId: "00000000-0000-4000-8000-000000000099",
      }),
    ).rejects.toMatchObject({ code: "LINK_NOT_FOUND" });

    store.links.push({
      ...ownedLink,
      address: "0x2222222222222222222222222222222222222222",
      id: "00000000-0000-4000-8000-000000000062",
    });
    await expect(
      service.unlink({
        linkId: ownedLink.id,
        requestId: "req-wallet-unlink-valid",
        userId: store.account.id,
      }),
    ).resolves.toEqual({ deleted: true });
    expect(store.links.map(({ id }) => id)).toEqual([
      "00000000-0000-4000-8000-000000000062",
    ]);
  });

  it("rejects wrong signer, address, chain, domain, URI and purpose without consuming", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const other = privateKeyToAccount(generatePrivateKey());
    const now = new Date("2026-08-14T09:00:00.000Z");

    for (const variant of ["signer", "address", "chain", "domain", "uri", "purpose"] as const) {
      const store = new MemoryLoginWalletStore();
      const service = authenticationService(store, () => now);
      const challenge = await service.createLoginChallenge({
        address: account.address,
        chainId: 56,
        requestId: `req-${variant}-nonce`,
      });
      const signedMessage =
        variant === "domain"
          ? challenge.message.replace("lpbot.local wants", "evil.local wants")
          : variant === "uri"
            ? challenge.message.replace(
                "URI: https://lpbot.local/login",
                "URI: https://evil.local/login",
              )
            : variant === "purpose"
              ? challenge.message.replace("auth-purpose:login", "auth-purpose:link")
              : challenge.message;
      const signer = variant === "signer" ? other : account;
      const signature = await signer.signMessage({ message: signedMessage });

      await expect(
        service.login({
          address: variant === "address" ? other.address : account.address,
          chainId: variant === "chain" ? 1 : 56,
          nonceId: challenge.nonceId,
          requestId: `req-${variant}-login`,
          signature,
        }),
      ).rejects.toMatchObject({
        code: variant === "address" || variant === "chain" ? "NONCE_MISMATCH" : "SIGNATURE_INVALID",
      });
      expect(store.challenges[0]?.consumedAt).toBeNull();
    }
  });

  it("rejects expired and replayed challenges and allows one concurrent consumption", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    let now = new Date("2026-08-14T09:10:00.000Z");
    const expiredStore = new MemoryLoginWalletStore();
    const expiredService = authenticationService(expiredStore, () => now);
    const expired = await expiredService.createLoginChallenge({
      address: account.address,
      chainId: 56,
      requestId: "req-expired-nonce",
    });
    const expiredSignature = await account.signMessage({ message: expired.message });
    now = new Date("2026-08-14T09:15:00.001Z");
    await expect(
      expiredService.login({
        address: account.address,
        chainId: 56,
        nonceId: expired.nonceId,
        requestId: "req-expired-login",
        signature: expiredSignature,
      }),
    ).rejects.toMatchObject({ code: "NONCE_EXPIRED" });

    now = new Date("2026-08-14T09:20:00.000Z");
    const raceStore = new MemoryLoginWalletStore();
    const raceService = authenticationService(raceStore, () => now);
    const race = await raceService.createLoginChallenge({
      address: account.address,
      chainId: 56,
      requestId: "req-race-nonce",
    });
    const raceSignature = await account.signMessage({ message: race.message });
    const results = await Promise.allSettled(
      ["a", "b"].map((suffix) =>
        raceService.login({
          address: account.address,
          chainId: 56,
          nonceId: race.nonceId,
          requestId: `req-race-${suffix}`,
          signature: raceSignature,
        }),
      ),
    );
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(results.filter(({ status }) => status === "rejected")).toHaveLength(1);
    await expect(
      raceService.login({
        address: account.address,
        chainId: 56,
        nonceId: race.nonceId,
        requestId: "req-race-replay",
        signature: raceSignature,
      }),
    ).rejects.toMatchObject({ code: "NONCE_REPLAYED" });
  });

  it("keeps login and link challenges purpose- and user-isolated", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const now = new Date("2026-08-14T09:30:00.000Z");
    const store = new MemoryLoginWalletStore();
    const service = authenticationService(store, () => now);
    const loginChallenge = await service.createLoginChallenge({
      address: account.address,
      chainId: 56,
      requestId: "req-purpose-login-nonce",
    });
    const loginSignature = await account.signMessage({ message: loginChallenge.message });
    await expect(
      service.link({
        address: account.address,
        chainId: 56,
        label: null,
        nonceId: loginChallenge.nonceId,
        requestId: "req-login-used-for-link",
        signature: loginSignature,
        userId: store.account.id,
      }),
    ).rejects.toMatchObject({ code: "NONCE_MISMATCH" });

    const linkChallenge = await service.createLinkChallenge({
      address: account.address,
      chainId: 56,
      requestId: "req-purpose-link-nonce",
      userId: store.account.id,
    });
    const linkSignature = await account.signMessage({ message: linkChallenge.message });
    await expect(
      service.login({
        address: account.address,
        chainId: 56,
        nonceId: linkChallenge.nonceId,
        requestId: "req-link-used-for-login",
        signature: linkSignature,
      }),
    ).rejects.toMatchObject({ code: "NONCE_MISMATCH" });
    await expect(
      service.link({
        address: account.address,
        chainId: 56,
        label: null,
        nonceId: linkChallenge.nonceId,
        requestId: "req-link-cross-user",
        signature: linkSignature,
        userId: "00000000-0000-4000-8000-000000000099",
      }),
    ).rejects.toMatchObject({ code: "NONCE_MISMATCH" });
  });

  it.each(["", " ", "line\nbreak", `x${"a".repeat(64)}`])(
    "rejects an invalid login-wallet label %j before consuming a challenge",
    async (label) => {
      const store = new MemoryLoginWalletStore();
      const service = authenticationService(store, () => new Date("2026-08-14T09:40:00.000Z"));
      await expect(
        service.link({
          address: "0x0000000000000000000000000000000000000001",
          chainId: 56,
          label,
          nonceId: "L".repeat(43),
          requestId: "req-label-invalid",
          signature: `0x${"ab".repeat(65)}`,
          userId: store.account.id,
        }),
      ).rejects.toMatchObject({ code: "LABEL_INVALID" });
      expect(store.challenges).toEqual([]);
    },
  );
});
