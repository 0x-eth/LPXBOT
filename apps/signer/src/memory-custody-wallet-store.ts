import type { CustodyWallet, CustodyWalletPage, WalletLockStatus } from "@lpbot/api-contract";

import type {
  CustodyEnvelope,
  CustodyWalletCreate,
  CustodyWalletStore,
  KeystoreStore,
  StoredKeystore,
  StoredKeystoreFailure,
  StoredCustodyWallet,
} from "./custody-types.js";
import { publicWallet } from "./custody-types.js";
import { SignerError } from "./signer-error.js";

function cloneEnvelope(envelope: CustodyEnvelope): CustodyEnvelope {
  return {
    ...envelope,
    ciphertext: Buffer.from(envelope.ciphertext),
    createdAt: new Date(envelope.createdAt),
    nonce: Buffer.from(envelope.nonce),
    tag: Buffer.from(envelope.tag),
    wrappedDek: Buffer.from(envelope.wrappedDek),
  };
}

function cloneWallet(wallet: StoredCustodyWallet): StoredCustodyWallet {
  return {
    ...wallet,
    createdAt: new Date(wallet.createdAt),
    updatedAt: new Date(wallet.updatedAt),
  };
}

function cloneKeystore(keystore: StoredKeystore): StoredKeystore {
  return {
    ...keystore,
    current: {
      ...keystore.current,
      createdAt: new Date(keystore.current.createdAt),
      salt: Buffer.from(keystore.current.salt),
      verifier: Buffer.from(keystore.current.verifier),
    },
    updatedAt: new Date(keystore.updatedAt),
  };
}

function cloneFailure(failure: StoredKeystoreFailure): StoredKeystoreFailure {
  return {
    ...failure,
    backoffUntil: new Date(failure.backoffUntil),
    lockedUntil: failure.lockedUntil ? new Date(failure.lockedUntil) : null,
    windowStartedAt: new Date(failure.windowStartedAt),
  };
}

export class InMemoryCustodyWalletStore implements CustodyWalletStore, KeystoreStore {
  readonly #audits: Array<{ action: string; walletId: string }> = [];
  readonly #envelopes = new Map<string, Map<number, CustodyEnvelope>>();
  readonly #failBeforeCommit: boolean;
  readonly #keystoreFailures = new Map<string, StoredKeystoreFailure>();
  readonly #keystores = new Map<string, StoredKeystore>();
  readonly #wallets = new Map<string, StoredCustodyWallet>();
  readonly openAttempts: number[] = [];

  constructor(options: { failBeforeCommit?: boolean } = {}) {
    this.#failBeforeCommit = options.failBeforeCommit ?? false;
  }

  get auditCount(): number {
    return this.#audits.length;
  }

  get envelopeCount(): number {
    return [...this.#envelopes.values()].reduce((count, versions) => count + versions.size, 0);
  }

  async create(input: CustodyWalletCreate): Promise<CustodyWallet> {
    const duplicate = [...this.#wallets.values()].some(
      (wallet) =>
        wallet.userId === input.wallet.userId && wallet.addressLower === input.wallet.addressLower,
    );
    if (duplicate) throw new SignerError("WALLET_ADDRESS_EXISTS");
    if (this.#failBeforeCommit) throw new SignerError("CUSTODY_STORE_UNAVAILABLE", true);

    const wallet = cloneWallet(input.wallet);
    const envelope = cloneEnvelope(input.envelope);
    this.#wallets.set(wallet.walletId, wallet);
    this.#envelopes.set(wallet.walletId, new Map([[envelope.envelopeVersion, envelope]]));
    this.#audits.push({ action: input.auditAction, walletId: wallet.walletId });
    return publicWallet(wallet);
  }

  async get(userId: string, walletId: string): Promise<StoredCustodyWallet | null> {
    const wallet = this.#wallets.get(walletId);
    return wallet?.userId === userId ? cloneWallet(wallet) : null;
  }

  async getCurrentEnvelope(
    walletId: string,
    envelopeVersion: number,
  ): Promise<CustodyEnvelope | null> {
    this.openAttempts.push(envelopeVersion);
    const envelope = this.#envelopes.get(walletId)?.get(envelopeVersion);
    return envelope ? cloneEnvelope(envelope) : null;
  }

  async list(userId: string): Promise<CustodyWalletPage> {
    return {
      items: [...this.#wallets.values()]
        .filter((wallet) => wallet.userId === userId)
        .sort(
          (left, right) =>
            right.createdAt.getTime() - left.createdAt.getTime() ||
            left.walletId.localeCompare(right.walletId),
        )
        .map(publicWallet),
    };
  }

  async setLockStatus(
    userId: string,
    walletId: string,
    status: WalletLockStatus,
    updatedAt: Date,
  ): Promise<void> {
    const wallet = this.#wallets.get(walletId);
    if (!wallet || wallet.userId !== userId) throw new SignerError("WALLET_NOT_FOUND");
    wallet.lockStatus = status;
    wallet.updatedAt = new Date(updatedAt);
    wallet.revision += 1;
  }

  async createKeystore(keystore: StoredKeystore): Promise<void> {
    if (this.#keystores.has(keystore.userId)) {
      throw new SignerError("PASSWORD_ALREADY_CONFIGURED");
    }
    this.#keystores.set(keystore.userId, cloneKeystore(keystore));
  }

  async getKeystore(userId: string): Promise<StoredKeystore | null> {
    const keystore = this.#keystores.get(userId);
    return keystore ? cloneKeystore(keystore) : null;
  }

  async rotateKeystore(input: {
    expectedVersion: number;
    next: StoredKeystore;
  }): Promise<void> {
    const current = this.#keystores.get(input.next.userId);
    if (!current || current.current.secretVersion !== input.expectedVersion) {
      throw new SignerError("SECRET_VERSION_CONFLICT");
    }
    this.#keystores.set(input.next.userId, cloneKeystore(input.next));
  }

  async updateKeystoreAutoLock(input: {
    expectedVersion: number;
    minutes: 1 | 5 | 15 | 30 | 60;
    updatedAt: Date;
    userId: string;
  }): Promise<void> {
    const keystore = this.#keystores.get(input.userId);
    if (!keystore || keystore.current.secretVersion !== input.expectedVersion) {
      throw new SignerError("SECRET_VERSION_CONFLICT");
    }
    keystore.autoLockMinutes = input.minutes;
    keystore.updatedAt = new Date(input.updatedAt);
  }

  async getKeystoreFailure(
    userId: string,
    sourceSessionId: string,
  ): Promise<StoredKeystoreFailure | null> {
    const failure = this.#keystoreFailures.get(`${userId}:${sourceSessionId}`);
    return failure ? cloneFailure(failure) : null;
  }

  async recordKeystoreFailure(input: {
    backoffMilliseconds: number;
    maxAttempts: number;
    now: Date;
    sourceSessionId: string;
    userId: string;
    windowMilliseconds: number;
  }): Promise<StoredKeystoreFailure> {
    const key = `${input.userId}:${input.sourceSessionId}`;
    const previous = this.#keystoreFailures.get(key);
    const expired =
      !previous || input.now.getTime() - previous.windowStartedAt.getTime() >= input.windowMilliseconds;
    const windowStartedAt = expired ? input.now : previous.windowStartedAt;
    const failureCount = expired ? 1 : previous.failureCount + 1;
    const failure: StoredKeystoreFailure = {
      backoffUntil: new Date(input.now.getTime() + input.backoffMilliseconds),
      failureCount,
      lockedUntil:
        failureCount >= input.maxAttempts
          ? new Date(windowStartedAt.getTime() + input.windowMilliseconds)
          : null,
      windowStartedAt: new Date(windowStartedAt),
    };
    this.#keystoreFailures.set(key, failure);
    return cloneFailure(failure);
  }

  async clearKeystoreFailures(userId: string, sourceSessionId: string): Promise<void> {
    this.#keystoreFailures.delete(`${userId}:${sourceSessionId}`);
  }

  async setUserPasswordWalletLockStatus(
    userId: string,
    status: WalletLockStatus,
    updatedAt: Date,
  ): Promise<void> {
    for (const wallet of this.#wallets.values()) {
      if (wallet.userId !== userId || wallet.mode !== "user-password") continue;
      if (wallet.lockStatus === status) continue;
      wallet.lockStatus = status;
      wallet.updatedAt = new Date(updatedAt);
      wallet.revision += 1;
    }
  }

  async mutateEnvelopeForTest(
    walletId: string,
    mutate: (envelope: CustodyEnvelope) => CustodyEnvelope,
  ): Promise<void> {
    const wallet = this.#wallets.get(walletId);
    if (!wallet) throw new Error("wallet fixture missing");
    const versions = this.#envelopes.get(walletId)!;
    const envelope = versions.get(wallet.envelopeVersion)!;
    versions.set(wallet.envelopeVersion, cloneEnvelope(mutate(cloneEnvelope(envelope))));
  }
}
