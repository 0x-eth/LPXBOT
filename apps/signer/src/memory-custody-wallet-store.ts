import type { CustodyWallet, CustodyWalletPage, WalletLockStatus } from "@lpbot/api-contract";

import type {
  CustodyEnvelope,
  CustodyWalletCreate,
  CustodyWalletStore,
  KeystoreStore,
  StoredKeystore,
  StoredKeystoreFailure,
  StoredCustodyWallet,
  WalletEnvelopeMaterial,
  WalletEnvelopeReplacement,
} from "./custody-types.js";
import { publicWallet } from "./custody-types.js";
import { SignerError } from "./signer-error.js";

function cloneEnvelope(envelope: CustodyEnvelope): CustodyEnvelope {
  return {
    ...envelope,
    ciphertext: Buffer.from(envelope.ciphertext),
    createdAt: new Date(envelope.createdAt),
    dekWrapNonce: envelope.dekWrapNonce ? Buffer.from(envelope.dekWrapNonce) : null,
    dekWrapTag: envelope.dekWrapTag ? Buffer.from(envelope.dekWrapTag) : null,
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
  readonly #failLifecycleAt: "before-commit" | null;
  readonly #keystoreFailures = new Map<string, StoredKeystoreFailure>();
  readonly #keystores = new Map<string, StoredKeystore>();
  readonly #wallets = new Map<string, StoredCustodyWallet>();
  readonly openAttempts: number[] = [];

  constructor(
    options: { failBeforeCommit?: boolean; failLifecycleAt?: "before-commit" } = {},
  ) {
    this.#failBeforeCommit = options.failBeforeCommit ?? false;
    this.#failLifecycleAt = options.failLifecycleAt ?? null;
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
    replacements?: WalletEnvelopeReplacement[];
  }): Promise<void> {
    const current = this.#keystores.get(input.next.userId);
    if (!current || current.current.secretVersion !== input.expectedVersion) {
      throw new SignerError("SECRET_VERSION_CONFLICT");
    }
    const replacements = input.replacements ?? [];
    for (const replacement of replacements) {
      const wallet = this.#wallets.get(replacement.wallet.walletId);
      if (
        !wallet ||
        wallet.userId !== input.next.userId ||
        wallet.mode !== "user-password" ||
        wallet.revision !== replacement.expectedRevision ||
        wallet.envelopeVersion !== replacement.expectedEnvelopeVersion ||
        replacement.envelope.envelopeVersion !== wallet.envelopeVersion + 1
      ) {
        throw new SignerError("REVISION_CONFLICT");
      }
    }
    if (this.#failLifecycleAt === "before-commit") {
      throw new SignerError("CUSTODY_STORE_UNAVAILABLE", true);
    }
    for (const replacement of replacements) {
      const wallet = this.#wallets.get(replacement.wallet.walletId)!;
      const envelope = cloneEnvelope(replacement.envelope);
      this.#envelopes.get(wallet.walletId)!.set(envelope.envelopeVersion, envelope);
      wallet.envelopeVersion = envelope.envelopeVersion;
      wallet.lockStatus = "locked";
      wallet.revision += 1;
      wallet.updatedAt = new Date(input.next.updatedAt);
      this.#audits.push({ action: "wallet.password-change", walletId: wallet.walletId });
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

  async listUserPasswordWalletMaterials(userId: string): Promise<WalletEnvelopeMaterial[]> {
    const result: WalletEnvelopeMaterial[] = [];
    for (const wallet of this.#wallets.values()) {
      if (wallet.userId !== userId || wallet.mode !== "user-password") continue;
      const envelope = this.#envelopes.get(wallet.walletId)?.get(wallet.envelopeVersion);
      if (!envelope) throw new SignerError("INVALID_CREDENTIALS");
      result.push({ envelope: cloneEnvelope(envelope), wallet: cloneWallet(wallet) });
    }
    return result;
  }

  async switchWalletEncryptionMode(input: {
    envelope: CustodyEnvelope;
    expectedRevision: number;
    expectedSecretVersion: number;
    lockStatus: WalletLockStatus;
    mode: StoredCustodyWallet["mode"];
    updatedAt: Date;
    userId: string;
    walletId: string;
  }): Promise<CustodyWallet> {
    const wallet = this.#wallets.get(input.walletId);
    const keystore = this.#keystores.get(input.userId);
    if (!wallet || wallet.userId !== input.userId) throw new SignerError("WALLET_NOT_FOUND");
    if (wallet.revision !== input.expectedRevision) throw new SignerError("REVISION_CONFLICT");
    if (!keystore || keystore.current.secretVersion !== input.expectedSecretVersion) {
      throw new SignerError("SECRET_VERSION_CONFLICT");
    }
    if (
      input.mode === wallet.mode ||
      input.envelope.envelopeVersion !== wallet.envelopeVersion + 1
    ) {
      throw new SignerError("INVALID_MODE");
    }
    if (this.#failLifecycleAt === "before-commit") {
      throw new SignerError("CUSTODY_STORE_UNAVAILABLE", true);
    }
    const envelope = cloneEnvelope(input.envelope);
    this.#envelopes.get(wallet.walletId)!.set(envelope.envelopeVersion, envelope);
    wallet.envelopeVersion = envelope.envelopeVersion;
    wallet.lockStatus = input.lockStatus;
    wallet.mode = input.mode;
    wallet.revision += 1;
    wallet.updatedAt = new Date(input.updatedAt);
    this.#audits.push({ action: "wallet.mode-switch", walletId: wallet.walletId });
    return publicWallet(wallet);
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
