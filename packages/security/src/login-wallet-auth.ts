import { createHash, createHmac, randomBytes } from "node:crypto";

import { getAddress } from "viem";
import { createSiweMessage } from "viem/siwe";

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

export interface LoginWalletAuthStore {
  createAuthWalletChallenge(challenge: NewAuthWalletChallenge): Promise<void>;
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

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export class LoginWalletAuthenticationService {
  readonly #challengeKey: Uint8Array;
  readonly #challengeTtlMilliseconds: number;
  readonly #domain: string;
  readonly #now: () => Date;
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
    this.#store = store;
    this.#uri = uri.toString();
  }

  async createLoginChallenge(
    input: CreateLoginWalletChallengeInput,
  ): Promise<CreatedLoginWalletChallenge> {
    const address = getAddress(input.address);
    if (!Number.isSafeInteger(input.chainId) || input.chainId <= 0) {
      throw new TypeError("Wallet chain ID must be a positive integer");
    }

    const issuedAt = this.#now();
    const expiresAt = new Date(issuedAt.getTime() + this.#challengeTtlMilliseconds);
    const nonceId = randomBytes(32).toString("base64url");
    const nonce = createHmac("sha256", this.#challengeKey)
      .update(`lpbot:siwe:nonce:v1:${nonceId}`, "utf8")
      .digest("hex");
    const message = createSiweMessage({
      address,
      chainId: input.chainId,
      domain: this.#domain,
      expirationTime: expiresAt,
      issuedAt,
      nonce,
      resources: ["urn:lpbot:auth-purpose:login"],
      statement: "Authenticate with LPBot. Purpose: login.",
      uri: this.#uri,
      version: "1",
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
}
