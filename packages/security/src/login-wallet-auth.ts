import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";

import { getAddress, verifyMessage, type Hex } from "viem";
import { createSiweMessage, parseSiweMessage, validateSiweMessage } from "viem/siwe";

import {
  SessionIssuer,
  type AccessAuditEvent,
  type IssuedSession,
  type SessionStore,
  type StoredAccount,
} from "./index.js";

export type AuthWalletChallengePurpose = "login" | "link";

export interface NewAuthWalletChallenge {
  address: string;
  chainId: number;
  expiresAt: Date;
  idHash: string;
  issuedAt: Date;
  messageHash: string;
  nonceHash: string;
  purpose: AuthWalletChallengePurpose;
  userId: string | null;
}

export interface StoredAuthWalletChallenge extends NewAuthWalletChallenge {
  consumedAt: Date | null;
}

export interface ConsumeAuthWalletLoginInput {
  address: string;
  candidateUserId: string;
  chainId: number;
  consumedAt: Date;
  idHash: string;
  messageHash: string;
  nonceHash: string;
}

export type ConsumeAuthWalletLoginResult =
  | { account: StoredAccount; status: "consumed" }
  | { account: null; status: "expired" | "invalid" | "replayed" };

export interface LoginWalletAuthStore extends SessionStore {
  consumeAuthWalletLogin(input: ConsumeAuthWalletLoginInput): Promise<ConsumeAuthWalletLoginResult>;
  createAuthWalletChallenge(challenge: NewAuthWalletChallenge): Promise<void>;
  findAuthWalletChallenge(idHash: string): Promise<StoredAuthWalletChallenge | null>;
}

export interface LoginWalletAuthenticationOptions {
  challengeKey: Uint8Array;
  challengeTtlSeconds: number;
  domain: string;
  now?: () => Date;
  sessionTtlSeconds: number;
  uri: string;
}

export interface CreateLoginWalletChallengeInput {
  address: string;
  chainId: number;
  requestId: string;
}

export interface CreatedLoginWalletChallenge {
  expiresAt: Date;
  message: string;
  nonceId: string;
}

export interface LoginWithWalletInput {
  address: string;
  chainId: number;
  nonceId: string;
  requestId: string;
  signature: string;
}

export interface LoginWithWalletResult {
  account: StoredAccount;
  session: IssuedSession;
}

export interface LoginWalletAuthenticationApplication {
  createLoginChallenge(
    input: CreateLoginWalletChallengeInput,
  ): Promise<CreatedLoginWalletChallenge>;
  login(input: LoginWithWalletInput): Promise<LoginWithWalletResult>;
}

export type WalletAuthenticationErrorCode =
  | "ADDRESS_INVALID"
  | "CHAIN_INVALID"
  | "NONCE_EXPIRED"
  | "NONCE_INVALID"
  | "NONCE_MISMATCH"
  | "NONCE_REPLAYED"
  | "SIGNATURE_INVALID";

export class WalletAuthenticationError extends Error {
  readonly code: WalletAuthenticationErrorCode;

  constructor(code: WalletAuthenticationErrorCode) {
    super(code);
    this.code = code;
    this.name = "WalletAuthenticationError";
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export class LoginWalletAuthenticationService implements LoginWalletAuthenticationApplication {
  readonly #challengeKey: Uint8Array;
  readonly #challengeTtlMilliseconds: number;
  readonly #domain: string;
  readonly #issuer: SessionIssuer;
  readonly #now: () => Date;
  readonly #sessionTtlMilliseconds: number;
  readonly #store: LoginWalletAuthStore;
  readonly #uri: string;

  constructor(store: LoginWalletAuthStore, options: LoginWalletAuthenticationOptions) {
    if (options.challengeKey.byteLength < 32) {
      throw new RangeError("Wallet challenge key must contain at least 32 bytes");
    }
    if (!Number.isSafeInteger(options.challengeTtlSeconds) || options.challengeTtlSeconds <= 0) {
      throw new RangeError("Wallet challenge TTL must be a positive integer");
    }
    if (!Number.isSafeInteger(options.sessionTtlSeconds) || options.sessionTtlSeconds <= 0) {
      throw new RangeError("Session TTL must be a positive integer");
    }
    const uri = new URL(options.uri);
    if (uri.host !== options.domain || uri.username || uri.password || uri.hash) {
      throw new TypeError("Wallet authentication URI must match its domain");
    }

    this.#challengeKey = options.challengeKey;
    this.#challengeTtlMilliseconds = options.challengeTtlSeconds * 1_000;
    this.#domain = options.domain;
    this.#now = options.now ?? (() => new Date());
    this.#issuer = new SessionIssuer(store, { now: this.#now });
    this.#sessionTtlMilliseconds = options.sessionTtlSeconds * 1_000;
    this.#store = store;
    this.#uri = uri.toString();
  }

  async createLoginChallenge(
    input: CreateLoginWalletChallengeInput,
  ): Promise<CreatedLoginWalletChallenge> {
    let address: `0x${string}`;
    try {
      address = getAddress(input.address);
    } catch {
      throw new WalletAuthenticationError("ADDRESS_INVALID");
    }
    if (!Number.isSafeInteger(input.chainId) || input.chainId <= 0) {
      throw new WalletAuthenticationError("CHAIN_INVALID");
    }

    const issuedAt = this.#now();
    const expiresAt = new Date(issuedAt.getTime() + this.#challengeTtlMilliseconds);
    const nonceId = randomBytes(32).toString("base64url");
    const nonce = this.#nonce(nonceId);
    const message = this.#message({
      address,
      chainId: input.chainId,
      expiresAt,
      issuedAt,
      nonce,
      purpose: "login",
      userId: null,
    });

    await this.#store.createAuthWalletChallenge({
      address: address.toLowerCase(),
      chainId: input.chainId,
      expiresAt,
      idHash: sha256(nonceId),
      issuedAt,
      messageHash: sha256(message),
      nonceHash: sha256(nonce),
      purpose: "login",
      userId: null,
    });
    return { expiresAt, message, nonceId };
  }

  async login(input: LoginWithWalletInput): Promise<LoginWithWalletResult> {
    const attemptedAt = this.#now();
    let address: `0x${string}`;
    try {
      address = getAddress(input.address);
    } catch {
      await this.#audit("denied", input.requestId, attemptedAt, null, null);
      throw new WalletAuthenticationError("ADDRESS_INVALID");
    }
    if (!Number.isSafeInteger(input.chainId) || input.chainId <= 0) {
      await this.#audit("denied", input.requestId, attemptedAt, null, null);
      throw new WalletAuthenticationError("CHAIN_INVALID");
    }
    if (!/^[A-Za-z0-9_-]{43}$/u.test(input.nonceId)) {
      await this.#audit("denied", input.requestId, attemptedAt, null, null);
      throw new WalletAuthenticationError("NONCE_INVALID");
    }
    if (!/^0x(?:[0-9a-fA-F]{128}|[0-9a-fA-F]{130})$/u.test(input.signature)) {
      await this.#audit("denied", input.requestId, attemptedAt, null, null);
      throw new WalletAuthenticationError("SIGNATURE_INVALID");
    }

    const idHash = sha256(input.nonceId);
    const challenge = await this.#store.findAuthWalletChallenge(idHash);
    if (!challenge) {
      await this.#audit("denied", input.requestId, attemptedAt, null, null);
      throw new WalletAuthenticationError("NONCE_INVALID");
    }
    if (challenge.consumedAt) {
      await this.#audit("denied", input.requestId, attemptedAt, null, null);
      throw new WalletAuthenticationError("NONCE_REPLAYED");
    }
    if (challenge.expiresAt.getTime() <= attemptedAt.getTime()) {
      await this.#audit("denied", input.requestId, attemptedAt, null, null);
      throw new WalletAuthenticationError("NONCE_EXPIRED");
    }
    if (
      challenge.purpose !== "login" ||
      challenge.userId !== null ||
      challenge.address !== address.toLowerCase() ||
      challenge.chainId !== input.chainId
    ) {
      await this.#audit("denied", input.requestId, attemptedAt, null, null);
      throw new WalletAuthenticationError("NONCE_MISMATCH");
    }

    const nonce = this.#nonce(input.nonceId);
    const message = this.#message({
      address,
      chainId: challenge.chainId,
      expiresAt: challenge.expiresAt,
      issuedAt: challenge.issuedAt,
      nonce,
      purpose: "login",
      userId: null,
    });
    const parsed = parseSiweMessage(message);
    const messageHash = sha256(message);
    const nonceHash = sha256(nonce);
    if (
      challenge.messageHash !== messageHash ||
      challenge.nonceHash !== nonceHash ||
      parsed.chainId !== challenge.chainId ||
      parsed.uri !== this.#uri ||
      parsed.resources?.length !== 1 ||
      parsed.resources[0] !== "urn:lpbot:auth-purpose:login" ||
      !validateSiweMessage({
        address,
        domain: this.#domain,
        message: parsed,
        nonce,
        time: attemptedAt,
      })
    ) {
      await this.#audit("denied", input.requestId, attemptedAt, null, null);
      throw new WalletAuthenticationError("NONCE_INVALID");
    }

    let validSignature = false;
    try {
      validSignature = await verifyMessage({
        address,
        message,
        signature: input.signature as Hex,
      });
    } catch {
      validSignature = false;
    }
    if (!validSignature) {
      await this.#audit("denied", input.requestId, attemptedAt, null, null);
      throw new WalletAuthenticationError("SIGNATURE_INVALID");
    }

    const consumed = await this.#store.consumeAuthWalletLogin({
      address: address.toLowerCase(),
      candidateUserId: randomUUID(),
      chainId: input.chainId,
      consumedAt: attemptedAt,
      idHash,
      messageHash,
      nonceHash,
    });
    if (consumed.status !== "consumed") {
      const code =
        consumed.status === "expired"
          ? "NONCE_EXPIRED"
          : consumed.status === "replayed"
            ? "NONCE_REPLAYED"
            : "NONCE_INVALID";
      await this.#audit("denied", input.requestId, attemptedAt, null, null);
      throw new WalletAuthenticationError(code);
    }

    const session = await this.#issuer.issue({
      expiresAt: new Date(attemptedAt.getTime() + this.#sessionTtlMilliseconds),
      userId: consumed.account.id,
    });
    await this.#audit(
      "allowed",
      input.requestId,
      attemptedAt,
      session.sessionId,
      consumed.account.id,
    );
    return { account: consumed.account, session };
  }

  #message(input: {
    address: `0x${string}`;
    chainId: number;
    expiresAt: Date;
    issuedAt: Date;
    nonce: string;
    purpose: AuthWalletChallengePurpose;
    userId: string | null;
  }): string {
    const resources = [`urn:lpbot:auth-purpose:${input.purpose}`];
    if (input.userId) resources.push(`urn:lpbot:auth-user:${input.userId}`);
    return createSiweMessage({
      address: input.address,
      chainId: input.chainId,
      domain: this.#domain,
      expirationTime: input.expiresAt,
      issuedAt: input.issuedAt,
      nonce: input.nonce,
      resources,
      statement: `Authenticate with LPBot. Purpose: ${input.purpose}.`,
      uri: this.#uri,
      version: "1",
    });
  }

  #nonce(nonceId: string): string {
    return createHmac("sha256", this.#challengeKey)
      .update(`lpbot:siwe:nonce:v1:${nonceId}`, "utf8")
      .digest("hex");
  }

  async #audit(
    outcome: AccessAuditEvent["outcome"],
    requestId: string,
    createdAt: Date,
    sessionId: string | null,
    userId: string | null,
  ): Promise<void> {
    await this.#store.recordAccessAudit({
      action: "wallet.login",
      createdAt,
      outcome,
      requestId,
      sessionId,
      userId,
    });
  }
}
