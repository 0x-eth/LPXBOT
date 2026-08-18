import type {
  CustodyWallet,
  CustodyWalletPage,
  WalletDeletionReceipt,
  WalletLockStatus,
} from "@lpbot/api-contract";

import type {
  CustodyEnvelope,
  CustodyWalletCreate,
  CustodyWalletStore,
  KeystoreStore,
  StoredKeystore,
  StoredKeystoreFailure,
  StoredKeystoreResetPreview,
  StoredCustodyWallet,
  StoredWalletDeletePreview,
  WalletEnvelopeMaterial,
  WalletEnvelopeReplacement,
  WalletDeleteCommit,
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

function cloneResetPreview(preview: StoredKeystoreResetPreview): StoredKeystoreResetPreview {
  return {
    ...preview,
    expiresAt: new Date(preview.expiresAt),
    previewTokenDigest: Buffer.from(preview.previewTokenDigest),
  };
}

function cloneWalletDeletePreview(preview: StoredWalletDeletePreview): StoredWalletDeletePreview {
  return {
    ...preview,
    assetIds: [...preview.assetIds],
    expiresAt: new Date(preview.expiresAt),
    policyIds: [...preview.policyIds],
    positionIds: [...preview.positionIds],
    previewTokenDigest: Buffer.from(preview.previewTokenDigest),
    taskIds: [...preview.taskIds],
  };
}

export class InMemoryCustodyWalletStore implements CustodyWalletStore, KeystoreStore {
  readonly #audits: Array<{ action: string; walletId: string }> = [];
  readonly #envelopes = new Map<string, Map<number, CustodyEnvelope>>();
  readonly #failBeforeCommit: boolean;
  readonly #failLifecycleAt: "before-commit" | null;
  readonly #keystoreFailures = new Map<string, StoredKeystoreFailure>();
  readonly #keystores = new Map<string, StoredKeystore>();
  readonly #resetPreviews = new Map<string, StoredKeystoreResetPreview>();
  readonly #wallets = new Map<string, StoredCustodyWallet>();
  readonly #walletDeletePreviews = new Map<string, StoredWalletDeletePreview>();
  readonly #walletTombstones = new Map<string, WalletDeletionReceipt>();
  readonly openAttempts: number[] = [];

  constructor(options: { failBeforeCommit?: boolean; failLifecycleAt?: "before-commit" } = {}) {
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

  async createWalletDeletePreview(preview: StoredWalletDeletePreview): Promise<void> {
    for (const [key, stored] of this.#walletDeletePreviews) {
      if (stored.userId === preview.userId && stored.walletId === preview.walletId) {
        this.#walletDeletePreviews.delete(key);
      }
    }
    this.#walletDeletePreviews.set(
      `${preview.userId}:${preview.walletId}:${preview.previewTokenDigest.toString("hex")}`,
      cloneWalletDeletePreview(preview),
    );
  }

  async getWalletDeletePreview(
    userId: string,
    walletId: string,
    previewTokenDigest: Uint8Array,
  ): Promise<StoredWalletDeletePreview | null> {
    const key = `${userId}:${walletId}:${Buffer.from(previewTokenDigest).toString("hex")}`;
    const preview = this.#walletDeletePreviews.get(key);
    return preview ? cloneWalletDeletePreview(preview) : null;
  }

  async deleteWallet(input: WalletDeleteCommit): Promise<WalletDeletionReceipt> {
    const wallet = this.#wallets.get(input.walletId);
    if (!wallet || wallet.userId !== input.userId) throw new SignerError("WALLET_NOT_FOUND");
    const key = `${input.userId}:${input.walletId}:${input.previewTokenDigest.toString("hex")}`;
    const preview = this.#walletDeletePreviews.get(key);
    if (!preview || preview.expiresAt <= input.now) throw new SignerError("PREVIEW_EXPIRED");
    if (wallet.revision !== input.expectedRevision || preview.revision !== input.expectedRevision) {
      throw new SignerError("REVISION_CONFLICT");
    }
    if (
      preview.assetRiskDigest !== input.assetRiskDigest ||
      JSON.stringify(preview.assetIds) !== JSON.stringify(input.assetIds) ||
      JSON.stringify(preview.policyIds) !== JSON.stringify(input.policyIds) ||
      JSON.stringify(preview.positionIds) !== JSON.stringify(input.positionIds) ||
      JSON.stringify(preview.taskIds) !== JSON.stringify(input.taskIds)
    ) {
      throw new SignerError("PREVIEW_CHANGED");
    }
    if (this.#failLifecycleAt === "before-commit") {
      throw new SignerError("CUSTODY_STORE_UNAVAILABLE", true);
    }
    const auditId = String(this.#audits.length + 1);
    const receipt: WalletDeletionReceipt = {
      address: wallet.address,
      auditId,
      deletedAt: input.now.toISOString(),
      deletionType: input.deletionType,
      finalRevision: wallet.revision + 1,
      walletId: wallet.walletId,
    };
    this.#audits.push({
      action: input.deletionType === "force" ? "wallet.force-delete" : "wallet.delete",
      walletId: wallet.walletId,
    });
    this.#walletTombstones.set(wallet.walletId, { ...receipt });
    this.#wallets.delete(wallet.walletId);
    this.#envelopes.delete(wallet.walletId);
    for (const [previewKey, stored] of this.#walletDeletePreviews) {
      if (stored.walletId === wallet.walletId) this.#walletDeletePreviews.delete(previewKey);
    }
    if (wallet.mode === "user-password") {
      for (const remaining of this.#wallets.values()) {
        if (
          remaining.userId !== input.userId ||
          remaining.mode !== "user-password" ||
          remaining.lockStatus === "locked"
        ) {
          continue;
        }
        remaining.lockStatus = "locked";
        remaining.revision += 1;
        remaining.updatedAt = new Date(input.now);
      }
    }
    return { ...receipt };
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

  async rename(input: {
    expectedRevision: number;
    name: string;
    updatedAt: Date;
    userId: string;
    walletId: string;
  }): Promise<CustodyWallet> {
    const wallet = this.#wallets.get(input.walletId);
    if (!wallet || wallet.userId !== input.userId) throw new SignerError("WALLET_NOT_FOUND");
    if (wallet.revision !== input.expectedRevision) throw new SignerError("REVISION_CONFLICT");
    if (wallet.name === input.name) return publicWallet(wallet);
    wallet.name = input.name;
    wallet.revision += 1;
    wallet.updatedAt = new Date(input.updatedAt);
    this.#audits.push({ action: "wallet.rename", walletId: wallet.walletId });
    return publicWallet(wallet);
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
      !previous ||
      input.now.getTime() - previous.windowStartedAt.getTime() >= input.windowMilliseconds;
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

  async createKeystoreResetPreview(preview: StoredKeystoreResetPreview): Promise<void> {
    this.#resetPreviews.set(
      `${preview.userId}:${preview.previewTokenDigest.toString("hex")}`,
      cloneResetPreview(preview),
    );
  }

  async getKeystoreResetPreview(
    userId: string,
    previewTokenDigest: Uint8Array,
  ): Promise<StoredKeystoreResetPreview | null> {
    const preview = this.#resetPreviews.get(
      `${userId}:${Buffer.from(previewTokenDigest).toString("hex")}`,
    );
    return preview ? cloneResetPreview(preview) : null;
  }

  async resetKeystore(input: {
    expectedVersion: number;
    now: Date;
    previewTokenDigest: Uint8Array;
    userId: string;
  }): Promise<void> {
    const previewKey = `${input.userId}:${Buffer.from(input.previewTokenDigest).toString("hex")}`;
    const preview = this.#resetPreviews.get(previewKey);
    const keystore = this.#keystores.get(input.userId);
    if (!preview || preview.expiresAt <= input.now) throw new SignerError("PREVIEW_EXPIRED");
    if (!keystore || keystore.current.secretVersion !== input.expectedVersion) {
      throw new SignerError("SECRET_VERSION_CONFLICT");
    }
    if (this.#failLifecycleAt === "before-commit") {
      throw new SignerError("CUSTODY_STORE_UNAVAILABLE", true);
    }
    const destroyed = [...this.#wallets.values()]
      .filter((wallet) => wallet.userId === input.userId && wallet.mode === "user-password")
      .map(({ walletId }) => walletId);
    for (const walletId of destroyed) {
      this.#wallets.delete(walletId);
      this.#envelopes.delete(walletId);
    }
    for (let index = this.#audits.length - 1; index >= 0; index -= 1) {
      if (destroyed.includes(this.#audits[index]!.walletId)) this.#audits.splice(index, 1);
    }
    this.#keystores.delete(input.userId);
    for (const key of this.#keystoreFailures.keys()) {
      if (key.startsWith(`${input.userId}:`)) this.#keystoreFailures.delete(key);
    }
    for (const key of this.#resetPreviews.keys()) {
      if (key.startsWith(`${input.userId}:`)) this.#resetPreviews.delete(key);
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
