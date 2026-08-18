import { randomBytes as systemRandomBytes, randomUUID, timingSafeEqual } from "node:crypto";

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

function secretRecord(ingress: Uint8Array, keys: readonly string[]): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(ingress).toString("utf8"));
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
    this.#keystoreStore = input.keystoreStore ?? (supportsKeystore(input.store) ? input.store : null);
    this.#monotonicNow = input.monotonicNow ?? (() => performance.now());
    this.#now = input.now ?? (() => new Date());
    this.#onZeroize = input.onZeroize ?? (() => undefined);
    this.#randomBytes = input.randomBytes ?? systemRandomBytes;
    this.#signer = input.signer;
    this.#signerInstance = input.signerInstance ?? randomUUID();
    this.#store = input.store;
    this.#uuid = input.uuid ?? randomUUID;
  }

  async keystoreStatus(
    userId: string,
    reauthenticatedSessionId?: string,
  ): Promise<KeystoreStatus> {
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
      const salt = Buffer.from(this.#randomBytes(16));
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
      const salt = Buffer.from(this.#randomBytes(16));
      if (salt.length !== 16) throw new SignerError("SIGNER_UNAVAILABLE", true);
      newKek = this.#derivePasswordKek(newPassword, salt);
      verifier = createPasswordVerifier(newKek, {
        secretVersion: nextVersion,
        userId: input.userId,
      });
      const now = this.#now();
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
      this.#unlockSessions.set(this.#sessionKey(input.userId, input.reauthenticatedSessionId), session);
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
    return this.keystoreStatus(input.userId);
  }

  async shutdown(): Promise<void> {
    const users = new Set([...this.#unlockSessions.values()].map(({ userId }) => userId));
    for (const userId of users) await this.#revokeUser(userId);
  }

  async importWallet(input: {
    ingress: Uint8Array;
    tenantId: string;
    userId: string;
  }): Promise<CustodyWallet> {
    const walletId = this.#uuid();
    const sealed = await this.#signer.importAndSeal({
      envelopeVersion: 1,
      ingress: input.ingress,
      tenantId: input.tenantId,
      userId: input.userId,
      walletId,
    });
    return this.#commit("wallet.import", input, walletId, sealed);
  }

  async generateWallet(input: {
    mode: WalletEncryptionMode;
    name: string;
    tenantId: string;
    userId: string;
  }): Promise<CustodyWallet> {
    if (input.mode !== "server-kek") throw new SignerError("INVALID_MODE");
    for (let attempt = 0; attempt < 32; attempt += 1) {
      const walletId = this.#uuid();
      const sealed = await this.#signer.generateAndSeal({
        envelopeVersion: 1,
        mode: input.mode,
        name: input.name,
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
  }

  async listWallets(userId: string): Promise<CustodyWalletPage> {
    return this.#store.list(userId);
  }

  async getWallet(userId: string, walletId: string): Promise<CustodyWallet | null> {
    const wallet = await this.#store.get(userId, walletId);
    return wallet ? publicWallet(wallet) : null;
  }

  async recoverWallet(input: {
    tenantId: string;
    userId: string;
    walletId: string;
  }): Promise<CustodyWallet> {
    const wallet = await this.#store.get(input.userId, input.walletId);
    if (!wallet || wallet.tenantId !== input.tenantId) throw new SignerError("WALLET_NOT_FOUND");
    const envelope = await this.#store.getCurrentEnvelope(wallet.walletId, wallet.envelopeVersion);
    if (!envelope) {
      await this.#store.setLockStatus(input.userId, input.walletId, "quarantined", this.#now());
      throw new SignerError("KEYSTORE_CORRUPTED");
    }
    try {
      await this.#signer.openAndVerify({ envelope, wallet });
      if (wallet.lockStatus !== "ready") {
        await this.#store.setLockStatus(input.userId, input.walletId, "ready", this.#now());
      }
      return (await this.getWallet(input.userId, input.walletId))!;
    } catch (error) {
      const signerError = asSignerError(error);
      const lockStatus = signerError.code === "KEYSTORE_CORRUPTED" ? "quarantined" : "locked";
      await this.#store.setLockStatus(input.userId, input.walletId, lockStatus, this.#now());
      throw signerError;
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
        lockStatus: "ready",
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
