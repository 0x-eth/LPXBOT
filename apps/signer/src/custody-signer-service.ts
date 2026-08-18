import {
  createHash,
  randomBytes as systemRandomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import type { CustodyWallet, CustodyWalletPage, WalletEncryptionMode } from "@lpbot/api-contract";

import type {
  CustodyWalletStore,
  KeystoreStatus,
  KeystoreStore,
  StoredKeystore,
  StoredKeystoreFailure,
  WalletDirectory,
  WalletSignerClient,
} from "./custody-types.js";
import { publicWallet } from "./custody-types.js";
import type { IsolatedWalletSigner, SealedWalletDraft } from "./isolated-wallet-signer.js";
import { createPasswordVerifier, deriveArgon2idKek } from "./password-crypto.js";
import { SignerError, asSignerError } from "./signer-error.js";

const autoLockMinutes = new Set([1, 5, 15, 30, 60]);
const failureWindowMilliseconds = 15 * 60 * 1_000;
const maximumFailures = 5;

type ZeroizeLabel = "derived-kek" | "password" | "secret-ingress";
type DerivePasswordKek = (password: Uint8Array, salt: Uint8Array) => Buffer;

export interface KeystoreDependencySnapshot {
  assetRiskDigest: string;
  complete: boolean;
  policyCount: number;
  strategyCount: number;
  taskCount: number;
  walletsWithNonzeroAssets: number;
  walletsWithPositions: number;
}

export interface KeystoreDependencyInventory {
  inspect(userId: string): Promise<KeystoreDependencySnapshot>;
}

export interface KeystoreResetPreview {
  confirmationPhrase: "I_LOSE_ALL_PASSWORD_WALLETS";
  expiresAt: string;
  policyCount: number;
  previewToken: string;
  secretVersion: number;
  strategyCount: number;
  taskCount: number;
  walletCount: number;
  walletsWithNonzeroAssets: number;
  walletsWithPositions: number;
}

interface UnlockSession {
  deadline: number;
  kek: Buffer;
  reauthenticatedSessionId: string;
  secretVersion: number;
  signerInstance: string;
  unlockVersion: number;
  userId: string;
}

function supportsKeystore(value: CustodyWalletStore): value is CustodyWalletStore & KeystoreStore {
  const candidate = value as Partial<KeystoreStore>;
  return (
    typeof candidate.getKeystore === "function" &&
    typeof candidate.createKeystore === "function" &&
    typeof candidate.rotateKeystore === "function"
  );
}

function passwordBytes(value: unknown): Buffer {
  if (typeof value !== "string") throw new SignerError("PASSWORD_POLICY_FAILED");
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length < 12 || bytes.length > 1_024 || bytes.includes(0)) {
    bytes.fill(0);
    throw new SignerError("PASSWORD_POLICY_FAILED");
  }
  return bytes;
}

function bufferView(bytes: Uint8Array): Buffer {
  return Buffer.from(bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.byteLength);
}

function secretRecord(ingress: Uint8Array, keys: readonly string[]): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bufferView(ingress).toString("utf8"));
  } catch {
    throw new SignerError("INVALID_CREDENTIALS");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new SignerError("INVALID_CREDENTIALS");
  }
  const record = parsed as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new SignerError("INVALID_CREDENTIALS");
  }
  return record;
}

export class CustodySignerService implements WalletDirectory, WalletSignerClient {
  readonly #now: () => Date;
  readonly #backoffJitter: (maximumExclusive: number) => number;
  readonly #derivePasswordKek: DerivePasswordKek;
  readonly #dependencyInventory: KeystoreDependencyInventory | null;
  readonly #keystoreStore: KeystoreStore | null;
  readonly #monotonicNow: () => number;
  readonly #onZeroize: (label: ZeroizeLabel, bytes: Uint8Array) => void;
  readonly #randomBytes: (length: number) => Uint8Array;
  readonly #signer: IsolatedWalletSigner;
  readonly #signerInstance: string;
  readonly #store: CustodyWalletStore;
  readonly #unlockSessions = new Map<string, UnlockSession>();
  #unlockVersion = 0;
  readonly #uuid: () => string;

  constructor(input: {
    backoffJitter?: (maximumExclusive: number) => number;
    dependencyInventory?: KeystoreDependencyInventory | undefined;
    derivePasswordKek?: DerivePasswordKek;
    keystoreStore?: KeystoreStore;
    monotonicNow?: () => number;
    now?: () => Date;
    onZeroize?: (label: ZeroizeLabel, bytes: Uint8Array) => void;
    randomBytes?: (length: number) => Uint8Array;
    signer: IsolatedWalletSigner;
    signerInstance?: string;
    store: CustodyWalletStore;
    uuid?: () => string;
  }) {
    this.#backoffJitter =
      input.backoffJitter ??
      ((maximumExclusive) =>
        maximumExclusive <= 1 ? 0 : systemRandomBytes(4).readUInt32BE(0) % maximumExclusive);
    this.#derivePasswordKek = input.derivePasswordKek ?? deriveArgon2idKek;
    this.#dependencyInventory = input.dependencyInventory ?? null;
    this.#keystoreStore =
      input.keystoreStore ?? (supportsKeystore(input.store) ? input.store : null);
    this.#monotonicNow = input.monotonicNow ?? (() => performance.now());
    this.#now = input.now ?? (() => new Date());
    this.#onZeroize = input.onZeroize ?? (() => undefined);
    this.#randomBytes = input.randomBytes ?? systemRandomBytes;
    this.#signer = input.signer;
    this.#signerInstance = input.signerInstance ?? randomUUID();
    this.#store = input.store;
    this.#uuid = input.uuid ?? randomUUID;
  }

  async keystoreStatus(userId: string, reauthenticatedSessionId?: string): Promise<KeystoreStatus> {
    const store = this.#requireKeystoreStore();
    await this.#expireUnlockSessions(userId);
    const keystore = await store.getKeystore(userId);
    if (!keystore) return { configured: false, status: "unconfigured", version: 0 };
    if (reauthenticatedSessionId) {
      const failure = await store.getKeystoreFailure(userId, reauthenticatedSessionId);
      if (this.#isLockedOut(failure)) {
        return { configured: true, status: "locked-out", version: keystore.current.secretVersion };
      }
      if (this.#session(userId, reauthenticatedSessionId)) {
        return { configured: true, status: "unlocked", version: keystore.current.secretVersion };
      }
    }
    return { configured: true, status: "locked", version: keystore.current.secretVersion };
  }

  async createKeystorePassword(input: {
    ingress: Uint8Array;
    userId: string;
  }): Promise<KeystoreStatus> {
    const store = this.#requireKeystoreStore();
    let password: Buffer | null = null;
    let kek: Buffer | null = null;
    let verifier: Buffer | null = null;
    try {
      const record = secretRecord(input.ingress, ["newPassword"]);
      password = passwordBytes(record.newPassword);
      record.newPassword = "";
      const salt = bufferView(this.#randomBytes(16));
      if (salt.length !== 16) throw new SignerError("SIGNER_UNAVAILABLE", true);
      kek = this.#derivePasswordKek(password, salt);
      verifier = createPasswordVerifier(kek, { secretVersion: 1, userId: input.userId });
      const now = this.#now();
      await store.createKeystore({
        autoLockMinutes: 15,
        current: {
          createdAt: now,
          parameterVersion: 1,
          salt,
          secretVersion: 1,
          verifier,
        },
        updatedAt: now,
        userId: input.userId,
      });
      return { configured: true, status: "locked", version: 1 };
    } finally {
      if (password) this.#zeroize("password", password);
      if (kek) this.#zeroize("derived-kek", kek);
      verifier?.fill(0);
      this.#zeroize("secret-ingress", input.ingress);
    }
  }

  async changeKeystorePassword(input: {
    ingress: Uint8Array;
    userId: string;
  }): Promise<KeystoreStatus> {
    const store = this.#requireKeystoreStore();
    let oldPassword: Buffer | null = null;
    let newPassword: Buffer | null = null;
    let oldKek: Buffer | null = null;
    let newKek: Buffer | null = null;
    let verifier: Buffer | null = null;
    let committed = false;
    try {
      const body = secretRecord(input.ingress, ["expectedVersion", "newPassword", "oldPassword"]);
      if (!Number.isSafeInteger(body.expectedVersion) || Number(body.expectedVersion) < 1) {
        throw new SignerError("SECRET_VERSION_CONFLICT");
      }
      oldPassword = passwordBytes(body.oldPassword);
      newPassword = passwordBytes(body.newPassword);
      body.oldPassword = "";
      body.newPassword = "";
      const current = await store.getKeystore(input.userId);
      if (!current || current.current.secretVersion !== body.expectedVersion) {
        throw new SignerError("SECRET_VERSION_CONFLICT");
      }
      oldKek = this.#verifyPassword(current, oldPassword);
      const nextVersion = current.current.secretVersion + 1;
      const salt = bufferView(this.#randomBytes(16));
      if (salt.length !== 16) throw new SignerError("SIGNER_UNAVAILABLE", true);
      newKek = this.#derivePasswordKek(newPassword, salt);
      verifier = createPasswordVerifier(newKek, {
        secretVersion: nextVersion,
        userId: input.userId,
      });
      const now = this.#now();
      const materials = await store.listUserPasswordWalletMaterials(input.userId);
      const replacements = [];
      for (const material of materials) {
        const envelope = await this.#signer.rekeyEnvelope({
          envelope: material.envelope,
          passwordKek: oldKek,
          targetMode: "user-password",
          targetPasswordKek: newKek,
          targetSecretVersion: nextVersion,
          wallet: material.wallet,
        });
        envelope.createdAt = now;
        replacements.push({
          envelope,
          expectedEnvelopeVersion: material.wallet.envelopeVersion,
          expectedRevision: material.wallet.revision,
          wallet: material.wallet,
        });
      }
      await store.rotateKeystore({
        expectedVersion: Number(body.expectedVersion),
        next: {
          autoLockMinutes: current.autoLockMinutes,
          current: {
            createdAt: now,
            parameterVersion: 1,
            salt,
            secretVersion: nextVersion,
            verifier,
          },
          updatedAt: now,
          userId: input.userId,
        },
        replacements,
      });
      committed = true;
      await this.#revokeUser(input.userId);
      return { configured: true, status: "locked", version: nextVersion };
    } finally {
      if (oldPassword) this.#zeroize("password", oldPassword);
      if (newPassword) this.#zeroize("password", newPassword);
      if (oldKek) this.#zeroize("derived-kek", oldKek);
      if (newKek) this.#zeroize("derived-kek", newKek);
      verifier?.fill(0);
      this.#zeroize("secret-ingress", input.ingress);
      if (!committed) {
        // Existing unlock capabilities remain valid when the atomic version swap did not commit.
      }
    }
  }

  async unlockKeystore(input: {
    ingress: Uint8Array;
    reauthenticatedSessionId: string;
    userId: string;
  }): Promise<KeystoreStatus> {
    const store = this.#requireKeystoreStore();
    let password: Buffer | null = null;
    let kek: Buffer | null = null;
    let retained = false;
    try {
      const body = secretRecord(input.ingress, ["password"]);
      password = passwordBytes(body.password);
      body.password = "";
      const now = this.#now();
      const failure = await store.getKeystoreFailure(input.userId, input.reauthenticatedSessionId);
      if (this.#isLockedOut(failure) || (failure && failure.backoffUntil > now)) {
        throw new SignerError("LOCKED_OUT");
      }
      const keystore = await store.getKeystore(input.userId);
      try {
        if (!keystore) throw new SignerError("INVALID_CREDENTIALS");
        kek = this.#verifyPassword(keystore, password);
      } catch {
        const previousCount = failure?.failureCount ?? 0;
        const base = Math.min(30_000, 2 ** previousCount * 1_000);
        const jitter = this.#backoffJitter(Math.max(1, Math.floor(base / 4)));
        await store.recordKeystoreFailure({
          backoffMilliseconds: base + jitter,
          maxAttempts: maximumFailures,
          now,
          sourceSessionId: input.reauthenticatedSessionId,
          userId: input.userId,
          windowMilliseconds: failureWindowMilliseconds,
        });
        throw new SignerError("INVALID_CREDENTIALS");
      }
      await store.clearKeystoreFailures(input.userId, input.reauthenticatedSessionId);
      this.#revokeSession(input.userId, input.reauthenticatedSessionId);
      const session: UnlockSession = {
        deadline: this.#monotonicNow() + keystore!.autoLockMinutes * 60_000,
        kek,
        reauthenticatedSessionId: input.reauthenticatedSessionId,
        secretVersion: keystore!.current.secretVersion,
        signerInstance: this.#signerInstance,
        unlockVersion: ++this.#unlockVersion,
        userId: input.userId,
      };
      this.#unlockSessions.set(
        this.#sessionKey(input.userId, input.reauthenticatedSessionId),
        session,
      );
      retained = true;
      await store.setUserPasswordWalletLockStatus(input.userId, "ready", now);
      return { configured: true, status: "unlocked", version: keystore!.current.secretVersion };
    } finally {
      if (password) this.#zeroize("password", password);
      if (kek && !retained) this.#zeroize("derived-kek", kek);
      this.#zeroize("secret-ingress", input.ingress);
    }
  }

  async lockKeystore(userId: string): Promise<KeystoreStatus> {
    const store = this.#requireKeystoreStore();
    await this.#revokeUser(userId);
    const keystore = await store.getKeystore(userId);
    return keystore
      ? { configured: true, status: "locked", version: keystore.current.secretVersion }
      : { configured: false, status: "unconfigured", version: 0 };
  }

  async updateKeystoreAutoLock(input: {
    expectedVersion: number;
    minutes: number;
    reauthenticatedSessionId: string;
    userId: string;
  }): Promise<KeystoreStatus> {
    const store = this.#requireKeystoreStore();
    if (!autoLockMinutes.has(input.minutes)) throw new SignerError("INVALID_AUTO_LOCK");
    await store.updateKeystoreAutoLock({
      expectedVersion: input.expectedVersion,
      minutes: input.minutes as 1 | 5 | 15 | 30 | 60,
      updatedAt: this.#now(),
      userId: input.userId,
    });
    for (const session of this.#unlockSessions.values()) {
      if (session.userId === input.userId) {
        session.deadline = this.#monotonicNow() + input.minutes * 60_000;
      }
    }
    return this.keystoreStatus(input.userId, input.reauthenticatedSessionId);
  }

  async shutdown(): Promise<void> {
    const users = new Set([...this.#unlockSessions.values()].map(({ userId }) => userId));
    for (const userId of users) await this.#revokeUser(userId);
  }

  async createKeystoreResetPreview(userId: string): Promise<KeystoreResetPreview> {
    const store = this.#requireKeystoreStore();
    const keystore = await store.getKeystore(userId);
    if (!keystore) throw new SignerError("INVALID_CREDENTIALS");
    const snapshot = await this.#resetSnapshot(userId);
    const tokenBytes = bufferView(this.#randomBytes(32));
    if (tokenBytes.length !== 32) throw new SignerError("SIGNER_UNAVAILABLE", true);
    const previewToken = tokenBytes.toString("base64url");
    const previewTokenDigest = createHash("sha256").update(tokenBytes).digest();
    tokenBytes.fill(0);
    const now = this.#now();
    const expiresAt = new Date(now.getTime() + 300_000);
    try {
      await store.createKeystoreResetPreview({
        contentDigest: this.#resetContentDigest(snapshot),
        expiresAt,
        previewTokenDigest,
        secretVersion: keystore.current.secretVersion,
        userId,
      });
    } finally {
      previewTokenDigest.fill(0);
    }
    return {
      confirmationPhrase: "I_LOSE_ALL_PASSWORD_WALLETS",
      expiresAt: expiresAt.toISOString(),
      policyCount: snapshot.policyCount,
      previewToken,
      secretVersion: keystore.current.secretVersion,
      strategyCount: snapshot.strategyCount,
      taskCount: snapshot.taskCount,
      walletCount: snapshot.walletCount,
      walletsWithNonzeroAssets: snapshot.walletsWithNonzeroAssets,
      walletsWithPositions: snapshot.walletsWithPositions,
    };
  }

  async resetKeystore(input: { ingress: Uint8Array; userId: string }): Promise<KeystoreStatus> {
    const store = this.#requireKeystoreStore();
    let previewTokenBytes: Buffer | null = null;
    let previewTokenDigest: Buffer | null = null;
    try {
      const body = secretRecord(input.ingress, [
        "confirmationPhrase",
        "expectedVersion",
        "previewToken",
      ]);
      if (body.confirmationPhrase !== "I_LOSE_ALL_PASSWORD_WALLETS") {
        throw new SignerError("CONFIRMATION_MISMATCH");
      }
      if (!Number.isSafeInteger(body.expectedVersion) || Number(body.expectedVersion) < 1) {
        throw new SignerError("SECRET_VERSION_CONFLICT");
      }
      if (
        typeof body.previewToken !== "string" ||
        body.previewToken.length < 32 ||
        body.previewToken.length > 128
      ) {
        throw new SignerError("PREVIEW_EXPIRED");
      }
      previewTokenBytes = Buffer.from(body.previewToken, "base64url");
      if (
        previewTokenBytes.length !== 32 ||
        previewTokenBytes.toString("base64url") !== body.previewToken
      ) {
        throw new SignerError("PREVIEW_EXPIRED");
      }
      body.previewToken = "";
      previewTokenDigest = createHash("sha256").update(previewTokenBytes).digest();
      const preview = await store.getKeystoreResetPreview(input.userId, previewTokenDigest);
      const now = this.#now();
      if (!preview || preview.expiresAt <= now) throw new SignerError("PREVIEW_EXPIRED");
      if (
        preview.secretVersion !== body.expectedVersion ||
        (await store.getKeystore(input.userId))?.current.secretVersion !== body.expectedVersion
      ) {
        throw new SignerError("SECRET_VERSION_CONFLICT");
      }
      const snapshot = await this.#resetSnapshot(input.userId);
      if (this.#resetContentDigest(snapshot) !== preview.contentDigest) {
        throw new SignerError("PREVIEW_CHANGED");
      }
      await store.resetKeystore({
        expectedVersion: Number(body.expectedVersion),
        now,
        previewTokenDigest,
        userId: input.userId,
      });
      await this.#revokeUser(input.userId);
      return { configured: false, status: "unconfigured", version: 0 };
    } finally {
      previewTokenBytes?.fill(0);
      previewTokenDigest?.fill(0);
      this.#zeroize("secret-ingress", input.ingress);
    }
  }

  async importWallet(input: {
    ingress: Uint8Array;
    tenantId: string;
    userId: string;
  }): Promise<CustodyWallet> {
    const walletId = this.#uuid();
    let password: Buffer | null = null;
    let passwordKek: Buffer | null = null;
    let signerOwnsIngress = false;
    try {
      let secretVersion: number | undefined;
      const mode = this.#walletIngressMode(input.ingress);
      if (mode === "user-password") {
        const body = secretRecord(input.ingress, ["mode", "name", "password", "privateKey"]);
        password = passwordBytes(body.password);
        body.password = "";
        const keystore = await this.#requireKeystoreStore().getKeystore(input.userId);
        if (!keystore) throw new SignerError("INVALID_CREDENTIALS");
        passwordKek = this.#verifyPassword(keystore, password);
        secretVersion = keystore.current.secretVersion;
      }
      signerOwnsIngress = true;
      const sealed = await this.#signer.importAndSeal({
        envelopeVersion: 1,
        ingress: input.ingress,
        passwordKek: passwordKek ?? undefined,
        secretVersion,
        tenantId: input.tenantId,
        userId: input.userId,
        walletId,
      });
      return this.#commit("wallet.import", input, walletId, sealed);
    } finally {
      if (password) this.#zeroize("password", password);
      if (passwordKek) this.#zeroize("derived-kek", passwordKek);
      if (!signerOwnsIngress) this.#zeroize("secret-ingress", input.ingress);
    }
  }

  async generateWallet(input: {
    ingress?: Uint8Array;
    mode: WalletEncryptionMode;
    name: string;
    tenantId: string;
    userId: string;
  }): Promise<CustodyWallet> {
    if (input.mode !== "server-kek" && input.mode !== "user-password") {
      throw new SignerError("INVALID_MODE");
    }
    let password: Buffer | null = null;
    let passwordKek: Buffer | null = null;
    try {
      let name = input.name;
      let secretVersion: number | undefined;
      if (input.mode === "user-password") {
        if (!input.ingress) throw new SignerError("INVALID_CREDENTIALS");
        const body = secretRecord(input.ingress, ["mode", "name", "password"]);
        if (body.mode !== "user-password" || typeof body.name !== "string") {
          throw new SignerError("INVALID_MODE");
        }
        name = body.name;
        password = passwordBytes(body.password);
        body.password = "";
        const keystore = await this.#requireKeystoreStore().getKeystore(input.userId);
        if (!keystore) throw new SignerError("INVALID_CREDENTIALS");
        passwordKek = this.#verifyPassword(keystore, password);
        secretVersion = keystore.current.secretVersion;
      }
      for (let attempt = 0; attempt < 32; attempt += 1) {
        const walletId = this.#uuid();
        const sealed = await this.#signer.generateAndSeal({
          envelopeVersion: 1,
          mode: input.mode,
          name,
          passwordKek: passwordKek ?? undefined,
          secretVersion,
          tenantId: input.tenantId,
          userId: input.userId,
          walletId,
        });
        try {
          return await this.#commit("wallet.generate", input, walletId, sealed);
        } catch (error) {
          const signerError = asSignerError(error);
          if (signerError.code !== "WALLET_ADDRESS_EXISTS") throw signerError;
        }
      }
      throw new SignerError("SIGNER_UNAVAILABLE", true);
    } finally {
      if (password) this.#zeroize("password", password);
      if (passwordKek) this.#zeroize("derived-kek", passwordKek);
      if (input.ingress) this.#zeroize("secret-ingress", input.ingress);
    }
  }

  async listWallets(userId: string): Promise<CustodyWalletPage> {
    return this.#store.list(userId);
  }

  async getWallet(userId: string, walletId: string): Promise<CustodyWallet | null> {
    const wallet = await this.#store.get(userId, walletId);
    return wallet ? publicWallet(wallet) : null;
  }

  async recoverWallet(input: {
    reauthenticatedSessionId?: string;
    tenantId: string;
    userId: string;
    walletId: string;
  }): Promise<CustodyWallet> {
    const wallet = await this.#store.get(input.userId, input.walletId);
    if (!wallet || wallet.tenantId !== input.tenantId) throw new SignerError("WALLET_NOT_FOUND");
    let passwordKek: Buffer | undefined;
    if (wallet.mode === "user-password") {
      await this.#expireUnlockSessions(input.userId);
      const session = input.reauthenticatedSessionId
        ? this.#session(input.userId, input.reauthenticatedSessionId)
        : null;
      if (!session) throw new SignerError("INVALID_CREDENTIALS");
      passwordKek = session.kek;
    }
    const envelope = await this.#store.getCurrentEnvelope(wallet.walletId, wallet.envelopeVersion);
    if (!envelope) {
      const code = wallet.mode === "user-password" ? "INVALID_CREDENTIALS" : "KEYSTORE_CORRUPTED";
      await this.#store.setLockStatus(
        input.userId,
        input.walletId,
        wallet.mode === "user-password" ? "locked" : "quarantined",
        this.#now(),
      );
      throw new SignerError(code);
    }
    try {
      await this.#signer.openAndVerify({ envelope, passwordKek, wallet });
      if (wallet.lockStatus !== "ready") {
        await this.#store.setLockStatus(input.userId, input.walletId, "ready", this.#now());
      }
      return (await this.getWallet(input.userId, input.walletId))!;
    } catch (error) {
      const signerError = asSignerError(error);
      const lockStatus =
        wallet.mode === "server-kek" && signerError.code === "KEYSTORE_CORRUPTED"
          ? "quarantined"
          : "locked";
      await this.#store.setLockStatus(input.userId, input.walletId, lockStatus, this.#now());
      throw signerError;
    }
  }

  async changeWalletEncryptionMode(input: {
    ingress: Uint8Array;
    tenantId: string;
    userId: string;
    walletId: string;
  }): Promise<CustodyWallet> {
    const store = this.#requireKeystoreStore();
    let password: Buffer | null = null;
    let passwordKek: Buffer | null = null;
    try {
      const body = secretRecord(input.ingress, [
        "expectedRevision",
        "expectedSecretVersion",
        "mode",
        "password",
      ]);
      if (body.mode !== "server-kek" && body.mode !== "user-password") {
        throw new SignerError("INVALID_MODE");
      }
      if (!Number.isSafeInteger(body.expectedRevision) || Number(body.expectedRevision) < 1) {
        throw new SignerError("REVISION_CONFLICT");
      }
      if (
        !Number.isSafeInteger(body.expectedSecretVersion) ||
        Number(body.expectedSecretVersion) < 1
      ) {
        throw new SignerError("SECRET_VERSION_CONFLICT");
      }
      const wallet = await this.#store.get(input.userId, input.walletId);
      if (!wallet || wallet.tenantId !== input.tenantId) throw new SignerError("WALLET_NOT_FOUND");
      if (wallet.revision !== body.expectedRevision) throw new SignerError("REVISION_CONFLICT");
      if (wallet.mode === body.mode) throw new SignerError("INVALID_MODE");
      const keystore = await store.getKeystore(input.userId);
      if (!keystore || keystore.current.secretVersion !== body.expectedSecretVersion) {
        throw new SignerError("SECRET_VERSION_CONFLICT");
      }
      password = passwordBytes(body.password);
      body.password = "";
      passwordKek = this.#verifyPassword(keystore, password);
      const envelope = await this.#store.getCurrentEnvelope(
        wallet.walletId,
        wallet.envelopeVersion,
      );
      if (!envelope) {
        throw new SignerError(
          wallet.mode === "user-password" ? "INVALID_CREDENTIALS" : "KEYSTORE_CORRUPTED",
        );
      }
      const replacement = await this.#signer.rekeyEnvelope({
        envelope,
        passwordKek: wallet.mode === "user-password" ? passwordKek : undefined,
        targetMode: body.mode,
        targetPasswordKek: body.mode === "user-password" ? passwordKek : undefined,
        targetSecretVersion:
          body.mode === "user-password" ? keystore.current.secretVersion : undefined,
        wallet,
      });
      const now = this.#now();
      replacement.createdAt = now;
      const result = await store.switchWalletEncryptionMode({
        envelope: replacement,
        expectedRevision: Number(body.expectedRevision),
        expectedSecretVersion: Number(body.expectedSecretVersion),
        lockStatus: body.mode === "user-password" ? "locked" : "ready",
        mode: body.mode,
        updatedAt: now,
        userId: input.userId,
        walletId: input.walletId,
      });
      await this.#revokeUser(input.userId);
      return result;
    } finally {
      if (password) this.#zeroize("password", password);
      if (passwordKek) this.#zeroize("derived-kek", passwordKek);
      this.#zeroize("secret-ingress", input.ingress);
    }
  }

  async #commit(
    auditAction: "wallet.generate" | "wallet.import",
    owner: { tenantId: string; userId: string },
    walletId: string,
    sealed: SealedWalletDraft,
  ): Promise<CustodyWallet> {
    const now = this.#now();
    sealed.envelope.createdAt = now;
    return this.#store.create({
      auditAction,
      envelope: sealed.envelope,
      wallet: {
        address: sealed.address,
        addressLower: sealed.addressLower,
        createdAt: now,
        envelopeVersion: sealed.envelope.envelopeVersion,
        lockStatus: sealed.mode === "user-password" ? "locked" : "ready",
        mode: sealed.mode,
        name: sealed.name,
        revision: 1,
        tenantId: owner.tenantId,
        updatedAt: now,
        userId: owner.userId,
        walletId,
      },
    });
  }

  #requireKeystoreStore(): KeystoreStore {
    if (!this.#keystoreStore) throw new SignerError("CUSTODY_STORE_UNAVAILABLE", true);
    return this.#keystoreStore;
  }

  #verifyPassword(keystore: StoredKeystore, password: Uint8Array): Buffer {
    if (
      keystore.current.parameterVersion !== 1 ||
      keystore.current.salt.length !== 16 ||
      keystore.current.verifier.length !== 32
    ) {
      throw new SignerError("INVALID_CREDENTIALS");
    }
    const kek = this.#derivePasswordKek(password, keystore.current.salt);
    let verifier: Buffer | null = null;
    try {
      verifier = createPasswordVerifier(kek, {
        secretVersion: keystore.current.secretVersion,
        userId: keystore.userId,
      });
      if (!timingSafeEqual(verifier, keystore.current.verifier)) {
        throw new SignerError("INVALID_CREDENTIALS");
      }
      return kek;
    } catch (error) {
      this.#zeroize("derived-kek", kek);
      throw error;
    } finally {
      verifier?.fill(0);
    }
  }

  #walletIngressMode(ingress: Uint8Array): unknown {
    try {
      const value = JSON.parse(bufferView(ingress).toString("utf8")) as unknown;
      return typeof value === "object" && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>).mode
        : null;
    } catch {
      return null;
    }
  }

  async #resetSnapshot(
    userId: string,
  ): Promise<KeystoreDependencySnapshot & { walletCount: number }> {
    if (!this.#dependencyInventory) {
      throw new SignerError("CUSTODY_STORE_UNAVAILABLE", true);
    }
    let inventory: KeystoreDependencySnapshot;
    try {
      inventory = await this.#dependencyInventory.inspect(userId);
    } catch {
      throw new SignerError("CUSTODY_STORE_UNAVAILABLE", true);
    }
    const counts = [
      inventory.policyCount,
      inventory.strategyCount,
      inventory.taskCount,
      inventory.walletsWithNonzeroAssets,
      inventory.walletsWithPositions,
    ];
    if (
      inventory.complete !== true ||
      counts.some((count) => !Number.isSafeInteger(count) || count < 0) ||
      typeof inventory.assetRiskDigest !== "string" ||
      inventory.assetRiskDigest.length < 1 ||
      inventory.assetRiskDigest.length > 256
    ) {
      throw new SignerError("CUSTODY_STORE_UNAVAILABLE", true);
    }
    const walletCount = (await this.#requireKeystoreStore().listUserPasswordWalletMaterials(userId))
      .length;
    return { ...inventory, walletCount };
  }

  #resetContentDigest(snapshot: KeystoreDependencySnapshot & { walletCount: number }): string {
    return createHash("sha256")
      .update(
        JSON.stringify({
          assetRiskDigest: snapshot.assetRiskDigest,
          policyCount: snapshot.policyCount,
          strategyCount: snapshot.strategyCount,
          taskCount: snapshot.taskCount,
          walletCount: snapshot.walletCount,
          walletsWithNonzeroAssets: snapshot.walletsWithNonzeroAssets,
          walletsWithPositions: snapshot.walletsWithPositions,
        }),
        "utf8",
      )
      .digest("hex");
  }

  async #expireUnlockSessions(userId: string): Promise<void> {
    const now = this.#monotonicNow();
    let expired = false;
    for (const [key, session] of this.#unlockSessions) {
      if (session.userId !== userId || session.deadline > now) continue;
      this.#unlockSessions.delete(key);
      this.#zeroize("derived-kek", session.kek);
      expired = true;
    }
    if (
      expired &&
      ![...this.#unlockSessions.values()].some((session) => session.userId === userId)
    ) {
      await this.#requireKeystoreStore().setUserPasswordWalletLockStatus(
        userId,
        "locked",
        this.#now(),
      );
    }
  }

  async #revokeUser(userId: string): Promise<void> {
    for (const [key, session] of this.#unlockSessions) {
      if (session.userId !== userId) continue;
      this.#unlockSessions.delete(key);
      this.#zeroize("derived-kek", session.kek);
    }
    await this.#requireKeystoreStore().setUserPasswordWalletLockStatus(
      userId,
      "locked",
      this.#now(),
    );
  }

  #revokeSession(userId: string, reauthenticatedSessionId: string): void {
    const key = this.#sessionKey(userId, reauthenticatedSessionId);
    const session = this.#unlockSessions.get(key);
    if (!session) return;
    this.#unlockSessions.delete(key);
    this.#zeroize("derived-kek", session.kek);
  }

  #session(userId: string, reauthenticatedSessionId: string): UnlockSession | null {
    const session = this.#unlockSessions.get(this.#sessionKey(userId, reauthenticatedSessionId));
    return session?.signerInstance === this.#signerInstance ? session : null;
  }

  #sessionKey(userId: string, reauthenticatedSessionId: string): string {
    return `${userId}:${reauthenticatedSessionId}`;
  }

  #isLockedOut(failure: StoredKeystoreFailure | null): boolean {
    return Boolean(failure?.lockedUntil && failure.lockedUntil > this.#now());
  }

  #zeroize(label: ZeroizeLabel, bytes: Uint8Array): void {
    bytes.fill(0);
    this.#onZeroize(label, bytes);
  }
}
