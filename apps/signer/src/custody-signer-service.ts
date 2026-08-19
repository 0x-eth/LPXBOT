import {
  createHash,
  randomBytes as systemRandomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import type {
  CustodyWallet,
  CustodyWalletPage,
  DeleteCustodyWalletRequest,
  SecurityPasswordStatus,
  WalletDeletePreview,
  WalletDeletionReceipt,
  WalletEncryptionMode,
} from "@lpbot/api-contract";
import type { WalletTransferPlan } from "@lpbot/domain/wallet-transfer";
import type { HelperDeploymentPlan } from "@lpbot/domain/helper-deployment";
import type {
  LocalSwapExecutionPlan,
  LocalSwapPermit2SigningPayload,
} from "@lpbot/domain/local-swap-execution";
import type { LocalPositionExecutionPlan } from "@lpbot/domain/local-position-execution";

import type {
  CustodyWalletStore,
  HelperDeploymentPlanAuthorizer,
  HelperDeploymentSigningResult,
  KeystoreStatus,
  KeystoreStore,
  LocalSwapPermit2Authorizer,
  LocalSwapPermit2SigningResult,
  LocalSwapStepPlanAuthorizer,
  LocalSwapStepSigningResult,
  LocalPositionStepPlanAuthorizer,
  LocalPositionStepSigningResult,
  SecurityPasswordStore,
  RawTransactionDelivery,
  StoredKeystore,
  StoredKeystoreFailure,
  StoredSecurityPassword,
  WalletDirectory,
  WalletDependencyInventory,
  WalletSignerClient,
  WalletTaskCoordinator,
  WalletTransferPlanAuthorizer,
  WalletTransferSigningResult,
} from "./custody-types.js";
import { publicWallet } from "./custody-types.js";
import type { IsolatedWalletSigner, SealedWalletDraft } from "./isolated-wallet-signer.js";
import { createPasswordVerifier, deriveArgon2idKek } from "./password-crypto.js";
import {
  createSecurityPasswordVerifier,
  deriveSecurityPasswordKey,
} from "./security-password-crypto.js";
import { SignerError, asSignerError } from "./signer-error.js";
import { privateKeyInputName } from "./wallet-crypto.js";

const autoLockMinutes = new Set([1, 5, 15, 30, 60]);
const failureWindowMilliseconds = 15 * 60 * 1_000;
const maximumFailures = 5;

type ZeroizeLabel = "derived-kek" | "password" | "secret-ingress";
type DerivePasswordKek = (password: Uint8Array, salt: Uint8Array) => Buffer;
type DeriveSecurityPasswordKey = (password: Uint8Array, salt: Uint8Array) => Buffer;

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

function supportsSecurityPassword(
  value: CustodyWalletStore,
): value is CustodyWalletStore & SecurityPasswordStore {
  const candidate = value as Partial<SecurityPasswordStore>;
  return (
    typeof candidate.getSecurityPassword === "function" &&
    typeof candidate.createSecurityPassword === "function" &&
    typeof candidate.rotateSecurityPassword === "function"
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
  readonly #deriveSecurityPasswordKey: DeriveSecurityPasswordKey;
  readonly #dependencyInventory: KeystoreDependencyInventory | null;
  readonly #keystoreStore: KeystoreStore | null;
  readonly #helperDeploymentPlanAuthorizer: HelperDeploymentPlanAuthorizer | null;
  readonly #localSwapPermit2Authorizer: LocalSwapPermit2Authorizer | null;
  readonly #localSwapStepPlanAuthorizer: LocalSwapStepPlanAuthorizer | null;
  readonly #localPositionStepPlanAuthorizer: LocalPositionStepPlanAuthorizer | null;
  readonly #monotonicNow: () => number;
  readonly #onZeroize: (label: ZeroizeLabel, bytes: Uint8Array) => void;
  readonly #randomBytes: (length: number) => Uint8Array;
  readonly #rawTransactionDelivery: RawTransactionDelivery | null;
  readonly #securityPasswordStore: SecurityPasswordStore | null;
  readonly #signer: IsolatedWalletSigner;
  readonly #signerInstance: string;
  readonly #store: CustodyWalletStore;
  readonly #taskCoordinator: WalletTaskCoordinator | null;
  readonly #transferPlanAuthorizer: WalletTransferPlanAuthorizer | null;
  readonly #unlockSessions = new Map<string, UnlockSession>();
  readonly #revokedWallets = new Set<string>();
  #unlockVersion = 0;
  readonly #uuid: () => string;
  readonly #walletDependencyInventory: WalletDependencyInventory | null;

  constructor(input: {
    backoffJitter?: (maximumExclusive: number) => number;
    dependencyInventory?: KeystoreDependencyInventory | undefined;
    derivePasswordKek?: DerivePasswordKek;
    deriveSecurityPasswordKey?: DeriveSecurityPasswordKey;
    keystoreStore?: KeystoreStore;
    helperDeploymentPlanAuthorizer?: HelperDeploymentPlanAuthorizer;
    localSwapPermit2Authorizer?: LocalSwapPermit2Authorizer;
    localSwapStepPlanAuthorizer?: LocalSwapStepPlanAuthorizer;
    localPositionStepPlanAuthorizer?: LocalPositionStepPlanAuthorizer;
    monotonicNow?: () => number;
    now?: () => Date;
    onZeroize?: (label: ZeroizeLabel, bytes: Uint8Array) => void;
    randomBytes?: (length: number) => Uint8Array;
    rawTransactionDelivery?: RawTransactionDelivery;
    securityPasswordStore?: SecurityPasswordStore;
    signer: IsolatedWalletSigner;
    signerInstance?: string;
    store: CustodyWalletStore;
    taskCoordinator?: WalletTaskCoordinator;
    transferPlanAuthorizer?: WalletTransferPlanAuthorizer;
    uuid?: () => string;
    walletDependencyInventory?: WalletDependencyInventory;
  }) {
    this.#backoffJitter =
      input.backoffJitter ??
      ((maximumExclusive) =>
        maximumExclusive <= 1 ? 0 : systemRandomBytes(4).readUInt32BE(0) % maximumExclusive);
    this.#derivePasswordKek = input.derivePasswordKek ?? deriveArgon2idKek;
    this.#deriveSecurityPasswordKey = input.deriveSecurityPasswordKey ?? deriveSecurityPasswordKey;
    this.#dependencyInventory = input.dependencyInventory ?? null;
    this.#keystoreStore =
      input.keystoreStore ?? (supportsKeystore(input.store) ? input.store : null);
    this.#helperDeploymentPlanAuthorizer = input.helperDeploymentPlanAuthorizer ?? null;
    this.#localSwapPermit2Authorizer = input.localSwapPermit2Authorizer ?? null;
    this.#localSwapStepPlanAuthorizer = input.localSwapStepPlanAuthorizer ?? null;
    this.#localPositionStepPlanAuthorizer = input.localPositionStepPlanAuthorizer ?? null;
    this.#monotonicNow = input.monotonicNow ?? (() => performance.now());
    this.#now = input.now ?? (() => new Date());
    this.#onZeroize = input.onZeroize ?? (() => undefined);
    this.#randomBytes = input.randomBytes ?? systemRandomBytes;
    this.#rawTransactionDelivery = input.rawTransactionDelivery ?? null;
    this.#securityPasswordStore =
      input.securityPasswordStore ?? (supportsSecurityPassword(input.store) ? input.store : null);
    this.#signer = input.signer;
    this.#signerInstance = input.signerInstance ?? randomUUID();
    this.#store = input.store;
    this.#taskCoordinator = input.taskCoordinator ?? null;
    this.#transferPlanAuthorizer = input.transferPlanAuthorizer ?? null;
    this.#uuid = input.uuid ?? randomUUID;
    this.#walletDependencyInventory = input.walletDependencyInventory ?? null;
  }

  transferSigningConfigured(): boolean {
    return this.#transferPlanAuthorizer !== null && this.#rawTransactionDelivery !== null;
  }

  helperDeploymentSigningConfigured(): boolean {
    return this.#helperDeploymentPlanAuthorizer !== null && this.#rawTransactionDelivery !== null;
  }

  localSwapStepSigningConfigured(): boolean {
    return this.#localSwapStepPlanAuthorizer !== null && this.#rawTransactionDelivery !== null;
  }

  localSwapPermit2SigningConfigured(): boolean {
    return this.#localSwapPermit2Authorizer !== null;
  }

  localPositionStepSigningConfigured(): boolean {
    return this.#localPositionStepPlanAuthorizer !== null && this.#rawTransactionDelivery !== null;
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

  async securityPasswordStatus(userId: string): Promise<SecurityPasswordStatus> {
    const password = await this.#requireSecurityPasswordStore().getSecurityPassword(userId);
    if (!password) return { configured: false, status: "unconfigured", version: 0 };
    return {
      configured: true,
      status: password.lockedUntil && password.lockedUntil > this.#now() ? "locked-out" : "ready",
      version: password.current.version,
    };
  }

  async putSecurityPassword(input: {
    ingress: Uint8Array;
    userId: string;
  }): Promise<SecurityPasswordStatus> {
    const store = this.#requireSecurityPasswordStore();
    let oldPassword: Buffer | null = null;
    let newPassword: Buffer | null = null;
    let oldKey: Buffer | null = null;
    let newKey: Buffer | null = null;
    let verifier: Buffer | null = null;
    let salt: Buffer | null = null;
    try {
      const body = secretRecord(input.ingress, ["expectedVersion", "newPassword", "oldPassword"]);
      if (!Number.isSafeInteger(body.expectedVersion) || Number(body.expectedVersion) < 0) {
        throw new SignerError("SECURITY_PASSWORD_VERSION_CONFLICT");
      }
      newPassword = passwordBytes(body.newPassword);
      body.newPassword = "";
      const expectedVersion = Number(body.expectedVersion);
      const current = await store.getSecurityPassword(input.userId);
      if (expectedVersion === 0) {
        if (body.oldPassword !== null || current) {
          throw new SignerError("SECURITY_PASSWORD_VERSION_CONFLICT");
        }
      } else {
        if (!current || current.current.version !== expectedVersion) {
          throw new SignerError("SECURITY_PASSWORD_VERSION_CONFLICT");
        }
        if (current.lockedUntil && current.lockedUntil > this.#now()) {
          throw new SignerError("LOCKED_OUT");
        }
        oldPassword = passwordBytes(body.oldPassword);
        body.oldPassword = "";
        try {
          oldKey = this.#verifySecurityPassword(current, oldPassword);
        } catch {
          await store.recordSecurityPasswordFailure({
            maxAttempts: maximumFailures,
            now: this.#now(),
            userId: input.userId,
            version: current.current.version,
          });
          throw new SignerError("INVALID_CREDENTIALS");
        }
      }
      salt = await this.#newSecurityPasswordSalt(input.userId);
      const nextVersion = expectedVersion + 1;
      newKey = this.#deriveSecurityPasswordKey(newPassword, salt);
      verifier = createSecurityPasswordVerifier(newKey, {
        userId: input.userId,
        version: nextVersion,
      });
      const now = this.#now();
      const next: StoredSecurityPassword = {
        current: {
          createdAt: now,
          parameterVersion: 1,
          salt,
          verifier,
          version: nextVersion,
        },
        failureCount: 0,
        lockedUntil: null,
        updatedAt: now,
        userId: input.userId,
      };
      if (expectedVersion === 0) {
        await store.createSecurityPassword(next);
      } else {
        await store.rotateSecurityPassword({ expectedVersion, next });
      }
      return { configured: true, status: "ready", version: nextVersion };
    } finally {
      if (oldPassword) this.#zeroize("password", oldPassword);
      if (newPassword) this.#zeroize("password", newPassword);
      if (oldKey) this.#zeroize("derived-kek", oldKey);
      if (newKey) this.#zeroize("derived-kek", newKey);
      salt?.fill(0);
      verifier?.fill(0);
      this.#zeroize("secret-ingress", input.ingress);
    }
  }

  async verifySecurityPassword(input: {
    ingress: Uint8Array;
    userId: string;
  }): Promise<{ verified: true; version: number }> {
    const store = this.#requireSecurityPasswordStore();
    let password: Buffer | null = null;
    let key: Buffer | null = null;
    try {
      const body = secretRecord(input.ingress, ["password"]);
      password = passwordBytes(body.password);
      body.password = "";
      const current = await store.getSecurityPassword(input.userId);
      if (!current || (current.lockedUntil && current.lockedUntil > this.#now())) {
        throw new SignerError(current ? "LOCKED_OUT" : "INVALID_CREDENTIALS");
      }
      try {
        key = this.#verifySecurityPassword(current, password);
      } catch {
        await store.recordSecurityPasswordFailure({
          maxAttempts: maximumFailures,
          now: this.#now(),
          userId: input.userId,
          version: current.current.version,
        });
        throw new SignerError("INVALID_CREDENTIALS");
      }
      await store.clearSecurityPasswordFailures({
        now: this.#now(),
        userId: input.userId,
        version: current.current.version,
      });
      return { verified: true, version: current.current.version };
    } finally {
      if (password) this.#zeroize("password", password);
      if (key) this.#zeroize("derived-kek", key);
      this.#zeroize("secret-ingress", input.ingress);
    }
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

  async createWalletDeletePreview(userId: string, walletId: string): Promise<WalletDeletePreview> {
    const wallet = await this.#store.get(userId, walletId);
    if (!wallet) throw new SignerError("WALLET_NOT_FOUND");
    const snapshot = await this.#walletDependencySnapshot(userId, walletId);
    const tokenBytes = bufferView(this.#randomBytes(32));
    const phraseBytes = bufferView(this.#randomBytes(4));
    if (tokenBytes.length !== 32 || phraseBytes.length !== 4) {
      tokenBytes.fill(0);
      phraseBytes.fill(0);
      throw new SignerError("SIGNER_UNAVAILABLE", true);
    }
    const previewToken = tokenBytes.toString("base64url");
    const previewTokenDigest = createHash("sha256").update(tokenBytes).digest();
    const confirmationPhrase = `DELETE WALLET ${phraseBytes.toString("hex").toUpperCase()}`;
    const expiresAt = new Date(this.#now().getTime() + 300_000);
    const forceEligible = snapshot.taskIds.length === 0 || this.#taskCoordinator !== null;
    try {
      await this.#store.createWalletDeletePreview({
        ...snapshot,
        confirmationPhrase,
        expiresAt,
        forceEligible,
        previewTokenDigest,
        revision: wallet.revision,
        userId,
        walletId,
      });
      return {
        assetCount: snapshot.assetIds.length,
        assetRiskDigest: snapshot.assetRiskDigest,
        confirmationPhrase,
        dependencies: {
          assetIds: [...snapshot.assetIds],
          policyIds: [...snapshot.policyIds],
          positionIds: [...snapshot.positionIds],
          taskIds: [...snapshot.taskIds],
        },
        expiresAt: expiresAt.toISOString(),
        forceEligible,
        policyCount: snapshot.policyIds.length,
        positionCount: snapshot.positionIds.length,
        previewToken,
        revision: wallet.revision,
        taskCount: snapshot.taskIds.length,
        walletId,
      };
    } finally {
      tokenBytes.fill(0);
      phraseBytes.fill(0);
      previewTokenDigest.fill(0);
    }
  }

  async deleteWallet(
    input: DeleteCustodyWalletRequest & { userId: string; walletId: string },
  ): Promise<WalletDeletionReceipt> {
    const wallet = await this.#store.get(input.userId, input.walletId);
    if (!wallet) throw new SignerError("WALLET_NOT_FOUND");
    const tokenBytes = Buffer.from(input.previewToken, "base64url");
    if (tokenBytes.length !== 32 || tokenBytes.toString("base64url") !== input.previewToken) {
      tokenBytes.fill(0);
      throw new SignerError("PREVIEW_EXPIRED");
    }
    const previewTokenDigest = createHash("sha256").update(tokenBytes).digest();
    tokenBytes.fill(0);
    let deactivation: Awaited<ReturnType<WalletTaskCoordinator["deactivate"]>> | null = null;
    try {
      const preview = await this.#store.getWalletDeletePreview(
        input.userId,
        input.walletId,
        previewTokenDigest,
      );
      const currentTime = this.#now();
      if (!preview || preview.expiresAt <= currentTime) throw new SignerError("PREVIEW_EXPIRED");
      if (input.expectedRevision !== preview.revision) throw new SignerError("REVISION_CONFLICT");
      if (wallet.revision !== preview.revision) throw new SignerError("PREVIEW_CHANGED");
      const snapshot = await this.#walletDependencySnapshot(input.userId, input.walletId);
      if (!this.#sameWalletDependencySnapshot(snapshot, preview)) {
        throw new SignerError("PREVIEW_CHANGED");
      }
      const dependencyCount =
        snapshot.assetIds.length +
        snapshot.policyIds.length +
        snapshot.positionIds.length +
        snapshot.taskIds.length;
      if (!input.force && dependencyCount > 0) throw new SignerError("DELETE_BLOCKED");
      if (input.force) {
        if (!preview.forceEligible) throw new SignerError("DELETE_BLOCKED");
        if (
          input.confirmationPhrase !== preview.confirmationPhrase ||
          !this.#sameWalletDependencySnapshot(input.dependencies, preview)
        ) {
          throw new SignerError(
            input.confirmationPhrase !== preview.confirmationPhrase
              ? "CONFIRMATION_MISMATCH"
              : "PREVIEW_CHANGED",
          );
        }
        if (snapshot.taskIds.length > 0) {
          if (!this.#taskCoordinator) throw new SignerError("DELETE_BLOCKED");
          try {
            deactivation = await this.#taskCoordinator.deactivate({
              taskIds: snapshot.taskIds,
              userId: input.userId,
              walletId: input.walletId,
            });
          } catch {
            throw new SignerError("CUSTODY_STORE_UNAVAILABLE", true);
          }
        }
      }
      const receipt = await this.#store.deleteWallet({
        ...snapshot,
        deletionType: input.force ? "force" : "normal",
        expectedRevision: input.expectedRevision,
        now: currentTime,
        previewTokenDigest,
        userId: input.userId,
        walletId: input.walletId,
      });
      this.#revokedWallets.add(input.walletId);
      if (wallet.mode === "user-password") this.#dropUserUnlockSessions(input.userId);
      return receipt;
    } catch (error) {
      if (deactivation) {
        try {
          await deactivation.restore();
        } catch {
          throw new SignerError("CUSTODY_STORE_UNAVAILABLE", true);
        }
      }
      throw error;
    } finally {
      previewTokenDigest.fill(0);
    }
  }

  async getWallet(userId: string, walletId: string): Promise<CustodyWallet | null> {
    const wallet = await this.#store.get(userId, walletId);
    return wallet ? publicWallet(wallet) : null;
  }

  async #walletDependencySnapshot(userId: string, walletId: string) {
    if (!this.#walletDependencyInventory) {
      throw new SignerError("CUSTODY_STORE_UNAVAILABLE", true);
    }
    let value;
    try {
      value = await this.#walletDependencyInventory.inspect({ userId, walletId });
    } catch {
      throw new SignerError("CUSTODY_STORE_UNAVAILABLE", true);
    }
    const list = (items: unknown): string[] => {
      if (
        !Array.isArray(items) ||
        items.some(
          (item) =>
            typeof item !== "string" ||
            item.length < 1 ||
            item.length > 256 ||
            /\p{Cc}/u.test(item),
        ) ||
        new Set(items).size !== items.length
      ) {
        throw new SignerError("CUSTODY_STORE_UNAVAILABLE", true);
      }
      return [...items].sort();
    };
    if (
      value.complete !== true ||
      typeof value.assetRiskDigest !== "string" ||
      value.assetRiskDigest.length < 1 ||
      value.assetRiskDigest.length > 256
    ) {
      throw new SignerError("CUSTODY_STORE_UNAVAILABLE", true);
    }
    return {
      assetIds: list(value.assetIds),
      assetRiskDigest: value.assetRiskDigest,
      complete: true,
      policyIds: list(value.policyIds),
      positionIds: list(value.positionIds),
      taskIds: list(value.taskIds),
    };
  }

  #sameWalletDependencySnapshot(
    left: {
      assetIds: readonly string[];
      assetRiskDigest?: string;
      policyIds: readonly string[];
      positionIds: readonly string[];
      taskIds: readonly string[];
    },
    right: {
      assetIds: readonly string[];
      assetRiskDigest?: string;
      policyIds: readonly string[];
      positionIds: readonly string[];
      taskIds: readonly string[];
    },
  ): boolean {
    return (
      (left.assetRiskDigest === undefined ||
        right.assetRiskDigest === undefined ||
        left.assetRiskDigest === right.assetRiskDigest) &&
      JSON.stringify(left.assetIds) === JSON.stringify(right.assetIds) &&
      JSON.stringify(left.policyIds) === JSON.stringify(right.policyIds) &&
      JSON.stringify(left.positionIds) === JSON.stringify(right.positionIds) &&
      JSON.stringify(left.taskIds) === JSON.stringify(right.taskIds)
    );
  }

  #dropUserUnlockSessions(userId: string): void {
    for (const [key, session] of this.#unlockSessions) {
      if (session.userId !== userId) continue;
      this.#unlockSessions.delete(key);
      this.#zeroize("derived-kek", session.kek);
    }
  }

  async renameWallet(input: {
    expectedRevision: number;
    name: string;
    updatedAt: Date;
    userId: string;
    walletId: string;
  }): Promise<CustodyWallet> {
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) {
      throw new SignerError("REVISION_CONFLICT");
    }
    return this.#store.rename({ ...input, name: privateKeyInputName(input.name) });
  }

  async signWalletTransfer(input: {
    plan: WalletTransferPlan;
    planDigest: `sha256:${string}`;
    reauthenticatedSessionId?: string;
    tenantId: string;
    userId: string;
  }): Promise<WalletTransferSigningResult> {
    const authorizer = this.#transferPlanAuthorizer;
    const delivery = this.#rawTransactionDelivery;
    if (!authorizer || !delivery) throw new SignerError("SIGNER_UNAVAILABLE", true);
    const authorization = {
      plan: input.plan,
      planDigest: input.planDigest,
      tenantId: input.tenantId,
      userId: input.userId,
    };
    if (!(await authorizer.authorize(authorization))) {
      throw new SignerError("TRANSFER_PLAN_REJECTED");
    }
    const wallet = await this.#store.get(input.userId, input.plan.walletId);
    if (
      !wallet ||
      wallet.tenantId !== input.tenantId ||
      wallet.addressLower !== input.plan.walletAddress ||
      wallet.lockStatus !== "ready"
    ) {
      throw new SignerError("TRANSFER_PLAN_REJECTED");
    }
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
      await this.#store.setLockStatus(
        input.userId,
        input.plan.walletId,
        wallet.mode === "user-password" ? "locked" : "quarantined",
        this.#now(),
      );
      throw new SignerError(
        wallet.mode === "user-password" ? "INVALID_CREDENTIALS" : "KEYSTORE_CORRUPTED",
      );
    }
    // Close the database-plan TOCTOU window immediately before private-key use.
    if (!(await authorizer.authorize(authorization))) {
      throw new SignerError("TRANSFER_PLAN_REJECTED");
    }
    return this.#signer.signAndDeliverTransfer({
      delivery,
      envelope,
      now: this.#now(),
      passwordKek,
      plan: input.plan,
      planDigest: input.planDigest,
      wallet,
    });
  }

  async signHelperDeployment(input: {
    plan: HelperDeploymentPlan;
    planDigest: `sha256:${string}`;
    reauthenticatedSessionId?: string;
    tenantId: string;
    userId: string;
  }): Promise<HelperDeploymentSigningResult> {
    const authorizer = this.#helperDeploymentPlanAuthorizer;
    const delivery = this.#rawTransactionDelivery;
    if (!authorizer || !delivery) throw new SignerError("SIGNER_UNAVAILABLE", true);
    const authorization = {
      plan: input.plan,
      planDigest: input.planDigest,
      tenantId: input.tenantId,
      userId: input.userId,
    };
    if (!(await authorizer.authorize(authorization))) {
      throw new SignerError("HELPER_PLAN_REJECTED");
    }
    const wallet = await this.#store.get(input.userId, input.plan.wallet.walletId);
    if (
      !wallet ||
      wallet.tenantId !== input.tenantId ||
      wallet.addressLower !== input.plan.wallet.address ||
      wallet.lockStatus !== "ready"
    ) {
      throw new SignerError("HELPER_PLAN_REJECTED");
    }
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
      await this.#store.setLockStatus(
        input.userId,
        input.plan.wallet.walletId,
        wallet.mode === "user-password" ? "locked" : "quarantined",
        this.#now(),
      );
      throw new SignerError(
        wallet.mode === "user-password" ? "INVALID_CREDENTIALS" : "KEYSTORE_CORRUPTED",
      );
    }
    // Re-run the database, Registry, chain-code, and fencing checks immediately before key use.
    if (!(await authorizer.authorize(authorization))) {
      throw new SignerError("HELPER_PLAN_REJECTED");
    }
    return this.#signer.signAndDeliverHelperDeployment({
      delivery,
      envelope,
      now: this.#now(),
      passwordKek,
      plan: input.plan,
      planDigest: input.planDigest,
      wallet,
    });
  }

  async signLocalSwapStep(input: {
    generation: number;
    maxFeePerGasBaseUnit: string;
    maxPriorityFeePerGasBaseUnit: string;
    plan: LocalSwapExecutionPlan;
    planDigest: `sha256:${string}`;
    reauthenticatedSessionId?: string;
    stepId: string;
    tenantId: string;
    userId: string;
  }): Promise<LocalSwapStepSigningResult> {
    const authorizer = this.#localSwapStepPlanAuthorizer;
    const delivery = this.#rawTransactionDelivery;
    if (!authorizer || !delivery) throw new SignerError("SIGNER_UNAVAILABLE", true);
    const authorization = {
      generation: input.generation,
      maxFeePerGasBaseUnit: input.maxFeePerGasBaseUnit,
      maxPriorityFeePerGasBaseUnit: input.maxPriorityFeePerGasBaseUnit,
      plan: input.plan,
      planDigest: input.planDigest,
      stepId: input.stepId,
      tenantId: input.tenantId,
      userId: input.userId,
    };
    if (!(await authorizer.authorize(authorization))) {
      throw new SignerError("LOCAL_SWAP_PLAN_REJECTED");
    }
    const wallet = await this.#store.get(input.userId, input.plan.wallet.walletId);
    if (
      !wallet ||
      wallet.tenantId !== input.tenantId ||
      wallet.addressLower !== input.plan.wallet.address ||
      wallet.lockStatus !== "ready"
    ) {
      throw new SignerError("LOCAL_SWAP_PLAN_REJECTED");
    }
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
      await this.#store.setLockStatus(
        input.userId,
        wallet.walletId,
        wallet.mode === "user-password" ? "locked" : "quarantined",
        this.#now(),
      );
      throw new SignerError(
        wallet.mode === "user-password" ? "INVALID_CREDENTIALS" : "KEYSTORE_CORRUPTED",
      );
    }
    if (!(await authorizer.authorize(authorization))) {
      throw new SignerError("LOCAL_SWAP_PLAN_REJECTED");
    }
    return this.#signer.signAndDeliverLocalSwapStep({
      delivery,
      envelope,
      generation: input.generation,
      maxFeePerGasBaseUnit: input.maxFeePerGasBaseUnit,
      maxPriorityFeePerGasBaseUnit: input.maxPriorityFeePerGasBaseUnit,
      now: this.#now(),
      passwordKek,
      plan: input.plan,
      planDigest: input.planDigest,
      stepId: input.stepId,
      wallet,
    });
  }

  async signLocalPositionStep(input: {
    generation: number;
    maxFeePerGasBaseUnit: string;
    maxPriorityFeePerGasBaseUnit: string;
    plan: LocalPositionExecutionPlan;
    planDigest: `sha256:${string}`;
    reauthenticatedSessionId?: string;
    stepId: string;
    tenantId: string;
    userId: string;
  }): Promise<LocalPositionStepSigningResult> {
    const authorizer = this.#localPositionStepPlanAuthorizer;
    const delivery = this.#rawTransactionDelivery;
    if (!authorizer || !delivery) throw new SignerError("SIGNER_UNAVAILABLE", true);
    const authorization = {
      generation: input.generation,
      maxFeePerGasBaseUnit: input.maxFeePerGasBaseUnit,
      maxPriorityFeePerGasBaseUnit: input.maxPriorityFeePerGasBaseUnit,
      plan: input.plan,
      planDigest: input.planDigest,
      stepId: input.stepId,
      tenantId: input.tenantId,
      userId: input.userId,
    };
    if (!(await authorizer.authorize(authorization))) {
      throw new SignerError("LOCAL_POSITION_PLAN_REJECTED");
    }
    const wallet = await this.#store.get(input.userId, input.plan.wallet.walletId);
    if (
      !wallet ||
      wallet.tenantId !== input.tenantId ||
      wallet.addressLower !== input.plan.wallet.address ||
      wallet.lockStatus !== "ready"
    ) {
      throw new SignerError("LOCAL_POSITION_PLAN_REJECTED");
    }
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
      await this.#store.setLockStatus(
        input.userId,
        wallet.walletId,
        wallet.mode === "user-password" ? "locked" : "quarantined",
        this.#now(),
      );
      throw new SignerError(
        wallet.mode === "user-password" ? "INVALID_CREDENTIALS" : "KEYSTORE_CORRUPTED",
      );
    }
    // Re-authorize after envelope lookup so a revoked step never reaches key use.
    if (!(await authorizer.authorize(authorization))) {
      throw new SignerError("LOCAL_POSITION_PLAN_REJECTED");
    }
    return this.#signer.signAndDeliverLocalPositionStep({
      delivery,
      envelope,
      generation: input.generation,
      maxFeePerGasBaseUnit: input.maxFeePerGasBaseUnit,
      maxPriorityFeePerGasBaseUnit: input.maxPriorityFeePerGasBaseUnit,
      now: this.#now(),
      passwordKek,
      plan: input.plan,
      planDigest: input.planDigest,
      stepId: input.stepId,
      wallet,
    });
  }

  async signLocalSwapPermit2(input: {
    payload: LocalSwapPermit2SigningPayload;
    reauthenticatedSessionId?: string;
    tenantId: string;
    userId: string;
  }): Promise<LocalSwapPermit2SigningResult> {
    const authorizer = this.#localSwapPermit2Authorizer;
    if (!authorizer) throw new SignerError("SIGNER_UNAVAILABLE", true);
    const authorization = {
      payload: input.payload,
      tenantId: input.tenantId,
      userId: input.userId,
    };
    if (!(await authorizer.authorize(authorization))) {
      throw new SignerError("PERMIT2_AUTHORIZATION_REJECTED");
    }
    const wallet = await this.#store.get(input.userId, input.payload.walletId);
    if (!wallet || wallet.tenantId !== input.tenantId || wallet.lockStatus !== "ready") {
      throw new SignerError("PERMIT2_AUTHORIZATION_REJECTED");
    }
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
    if (!envelope) throw new SignerError("KEYSTORE_CORRUPTED");
    if (!(await authorizer.authorize(authorization))) {
      throw new SignerError("PERMIT2_AUTHORIZATION_REJECTED");
    }
    return this.#signer.signLocalSwapPermit2Authorization({
      envelope,
      passwordKek,
      payload: input.payload,
      wallet,
    });
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

  #requireSecurityPasswordStore(): SecurityPasswordStore {
    if (!this.#securityPasswordStore) throw new SignerError("CUSTODY_STORE_UNAVAILABLE", true);
    return this.#securityPasswordStore;
  }

  async #newSecurityPasswordSalt(userId: string): Promise<Buffer> {
    const keystore = this.#keystoreStore ? await this.#keystoreStore.getKeystore(userId) : null;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const salt = bufferView(this.#randomBytes(16));
      if (salt.length !== 16) {
        salt.fill(0);
        throw new SignerError("SIGNER_UNAVAILABLE", true);
      }
      if (
        !keystore ||
        keystore.current.salt.length !== salt.length ||
        !timingSafeEqual(keystore.current.salt, salt)
      ) {
        return salt;
      }
      salt.fill(0);
    }
    throw new SignerError("SIGNER_UNAVAILABLE", true);
  }

  #verifySecurityPassword(password: StoredSecurityPassword, candidate: Uint8Array): Buffer {
    if (
      password.current.parameterVersion !== 1 ||
      password.current.salt.length !== 16 ||
      password.current.verifier.length !== 32
    ) {
      throw new SignerError("INVALID_CREDENTIALS");
    }
    const key = this.#deriveSecurityPasswordKey(candidate, password.current.salt);
    let verifier: Buffer | null = null;
    try {
      verifier = createSecurityPasswordVerifier(key, {
        userId: password.userId,
        version: password.current.version,
      });
      if (!timingSafeEqual(verifier, password.current.verifier)) {
        throw new SignerError("INVALID_CREDENTIALS");
      }
      return key;
    } catch (error) {
      this.#zeroize("derived-kek", key);
      throw error;
    } finally {
      verifier?.fill(0);
    }
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
