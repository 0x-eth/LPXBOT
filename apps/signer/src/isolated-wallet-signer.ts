import { randomBytes as systemRandomBytes } from "node:crypto";

import type { WalletEncryptionMode } from "@lpbot/api-contract";

import type { CustodyEnvelope, StoredCustodyWallet } from "./custody-types.js";
import type { KmsClient } from "./kms.js";
import {
  buildPasswordDekWrapAad,
  openPasswordDekWrap,
  sealPasswordDekWrap,
} from "./password-crypto.js";
import { SignerError } from "./signer-error.js";
import {
  buildWalletAad,
  deriveEvmAddress,
  generatePrivateKey,
  openEnvelope,
  parsePrivateKey,
  privateKeyInputName,
  sealEnvelope,
} from "./wallet-crypto.js";

export const signerCapabilities = [
  "import",
  "generate",
  "seal",
  "open-verify",
  "password-reseal",
] as const;

export interface SealedWalletDraft {
  address: `0x${string}`;
  addressLower: `0x${string}`;
  envelope: CustodyEnvelope;
  mode: WalletEncryptionMode;
  name: string;
}

interface SecretImportBody {
  mode: WalletEncryptionMode;
  name: string;
  privateKey: string;
}

function parseIngress(bytes: Uint8Array): SecretImportBody {
  try {
    const parsed = JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new SignerError("INVALID_PRIVATE_KEY");
    }
    const record = parsed as Record<string, unknown>;
    if (record.mode !== "server-kek" && record.mode !== "user-password") {
      throw new SignerError("INVALID_MODE");
    }
    const allowed =
      record.mode === "user-password"
        ? ["mode", "name", "password", "privateKey"]
        : ["mode", "name", "privateKey"];
    if (
      Object.keys(record).some((key) => !allowed.includes(key)) ||
      Object.keys(record).length !== allowed.length ||
      !Object.hasOwn(record, "privateKey") ||
      (record.mode === "user-password" && typeof record.password !== "string")
    ) {
      throw new SignerError("INVALID_PRIVATE_KEY");
    }
    record.password = "";
    return {
      mode: record.mode,
      name: privateKeyInputName(record.name),
      privateKey: typeof record.privateKey === "string" ? record.privateKey : "",
    };
  } catch (error) {
    if (error instanceof SignerError) throw error;
    throw new SignerError("INVALID_PRIVATE_KEY");
  }
}

type ZeroizeLabel = "dek" | "ingress" | "private-key";

export class IsolatedWalletSigner {
  readonly #kms: KmsClient;
  readonly #onZeroize: (label: ZeroizeLabel, bytes: Uint8Array) => void;
  readonly #privateKeyRandomBytes: (length: number) => Uint8Array;
  readonly #secretRandomBytes: (length: number) => Uint8Array;

  constructor(input: {
    kms: KmsClient;
    onZeroize?: (label: ZeroizeLabel, bytes: Uint8Array) => void;
    randomBytes?: (length: number) => Uint8Array;
    secretRandomBytes?: (length: number) => Uint8Array;
  }) {
    this.#kms = input.kms;
    this.#onZeroize = input.onZeroize ?? (() => undefined);
    this.#privateKeyRandomBytes = input.randomBytes ?? systemRandomBytes;
    this.#secretRandomBytes = input.secretRandomBytes ?? systemRandomBytes;
  }

  async importAndSeal(input: {
    envelopeVersion: number;
    ingress: Uint8Array;
    passwordKek?: Uint8Array;
    secretVersion?: number;
    tenantId: string;
    userId: string;
    walletId: string;
  }): Promise<SealedWalletDraft> {
    let privateKey: Buffer | null = null;
    try {
      const body = parseIngress(input.ingress);
      privateKey = parsePrivateKey(body.privateKey);
      body.privateKey = "";
      return await this.seal({ ...input, mode: body.mode, name: body.name, privateKey });
    } finally {
      if (privateKey) this.#zeroize("private-key", privateKey);
      this.#zeroize("ingress", input.ingress);
    }
  }

  async generateAndSeal(input: {
    envelopeVersion: number;
    mode: WalletEncryptionMode;
    name: string;
    passwordKek?: Uint8Array;
    secretVersion?: number;
    tenantId: string;
    userId: string;
    walletId: string;
  }): Promise<SealedWalletDraft> {
    if (input.mode !== "server-kek" && input.mode !== "user-password") {
      throw new SignerError("INVALID_MODE");
    }
    const privateKey = generatePrivateKey(this.#privateKeyRandomBytes);
    try {
      return await this.seal({ ...input, name: privateKeyInputName(input.name), privateKey });
    } finally {
      this.#zeroize("private-key", privateKey);
    }
  }

  async seal(input: {
    envelopeVersion: number;
    mode: WalletEncryptionMode;
    name: string;
    passwordKek?: Uint8Array;
    privateKey: Uint8Array;
    secretVersion?: number;
    tenantId: string;
    userId: string;
    walletId: string;
  }): Promise<SealedWalletDraft> {
    const address = deriveEvmAddress(input.privateKey);
    const dek = Buffer.from(this.#secretRandomBytes(32));
    if (dek.length !== 32) {
      dek.fill(0);
      throw new SignerError("SIGNER_UNAVAILABLE", true);
    }
    try {
      const envelope = await this.#sealMaterial({
        addressLower: address.lowercaseAddress,
        dek,
        envelopeVersion: input.envelopeVersion,
        mode: input.mode,
        passwordKek: input.passwordKek,
        privateKey: input.privateKey,
        secretVersion: input.secretVersion,
        tenantId: input.tenantId,
        userId: input.userId,
        walletId: input.walletId,
      });
      return {
        address: address.checksumAddress,
        addressLower: address.lowercaseAddress,
        envelope,
        mode: input.mode,
        name: input.name,
      };
    } finally {
      this.#zeroize("dek", dek);
    }
  }

  async openAndVerify(input: {
    envelope: CustodyEnvelope;
    passwordKek?: Uint8Array;
    wallet: StoredCustodyWallet;
  }): Promise<{ address: `0x${string}`; verified: true }> {
    const material = await this.#openMaterial(input);
    try {
      return { address: deriveEvmAddress(material.privateKey).checksumAddress, verified: true };
    } finally {
      this.#zeroize("private-key", material.privateKey);
      this.#zeroize("dek", material.dek);
    }
  }

  async rekeyEnvelope(input: {
    envelope: CustodyEnvelope;
    passwordKek?: Uint8Array;
    targetMode: WalletEncryptionMode;
    targetPasswordKek?: Uint8Array;
    targetSecretVersion?: number;
    wallet: StoredCustodyWallet;
  }): Promise<CustodyEnvelope> {
    const material = await this.#openMaterial({
      envelope: input.envelope,
      passwordKek: input.passwordKek,
      wallet: input.wallet,
    });
    try {
      return await this.#sealMaterial({
        addressLower: input.wallet.addressLower,
        dek: material.dek,
        envelopeVersion: input.envelope.envelopeVersion + 1,
        mode: input.targetMode,
        passwordKek: input.targetPasswordKek,
        privateKey: material.privateKey,
        secretVersion: input.targetSecretVersion,
        tenantId: input.wallet.tenantId,
        userId: input.wallet.userId,
        walletId: input.wallet.walletId,
      });
    } finally {
      this.#zeroize("private-key", material.privateKey);
      this.#zeroize("dek", material.dek);
    }
  }

  async #sealMaterial(input: {
    addressLower: `0x${string}`;
    dek: Uint8Array;
    envelopeVersion: number;
    mode: WalletEncryptionMode;
    passwordKek?: Uint8Array;
    privateKey: Uint8Array;
    secretVersion?: number;
    tenantId: string;
    userId: string;
    walletId: string;
  }): Promise<CustodyEnvelope> {
    if (input.mode !== "server-kek" && input.mode !== "user-password") {
      throw new SignerError("INVALID_MODE");
    }
    const mainNonce = Buffer.from(this.#secretRandomBytes(12));
    if (mainNonce.length !== 12) {
      mainNonce.fill(0);
      throw new SignerError("SIGNER_UNAVAILABLE", true);
    }
    let aad: Buffer | null = null;
    let wrapAad: Buffer | null = null;
    let wrapNonce: Buffer | null = null;
    try {
      if (input.mode === "server-kek") {
        const key = await this.#kms.activeKey();
        aad = buildWalletAad({
          address: input.addressLower,
          envelopeVersion: input.envelopeVersion,
          kekVersion: key.kekVersion,
          mode: input.mode,
          tenantId: input.tenantId,
          userId: input.userId,
          walletId: input.walletId,
        });
        const sealed = sealEnvelope({
          aad,
          dek: input.dek,
          nonce: mainNonce,
          plaintext: input.privateKey,
        });
        const wrapped = await this.#kms.wrapDek({ dek: input.dek, key });
        return {
          aadVersion: 1,
          algorithm: "AES-256-GCM",
          ciphertext: sealed.ciphertext,
          createdAt: new Date(),
          dekWrapNonce: null,
          dekWrapTag: null,
          dekWrapVersion: 1,
          envelopeVersion: input.envelopeVersion,
          kekId: wrapped.kekId,
          kekVersion: wrapped.kekVersion,
          nonce: sealed.nonce,
          secretVersion: null,
          tag: sealed.tag,
          wrappedDek: wrapped.wrappedDek,
        };
      }

      if (
        !input.passwordKek ||
        input.passwordKek.length !== 32 ||
        !Number.isSafeInteger(input.secretVersion) ||
        input.secretVersion! < 1
      ) {
        throw new SignerError("INVALID_CREDENTIALS");
      }
      const kekVersion = `secret-v${input.secretVersion}`;
      aad = buildWalletAad({
        address: input.addressLower,
        envelopeVersion: input.envelopeVersion,
        kekVersion,
        mode: input.mode,
        tenantId: input.tenantId,
        userId: input.userId,
        walletId: input.walletId,
      });
      const sealed = sealEnvelope({
        aad,
        dek: input.dek,
        nonce: mainNonce,
        plaintext: input.privateKey,
      });
      wrapAad = buildPasswordDekWrapAad({
        envelopeVersion: input.envelopeVersion,
        secretVersion: input.secretVersion!,
        tenantId: input.tenantId,
        userId: input.userId,
        walletId: input.walletId,
        wrapVersion: 1,
      });
      wrapNonce = Buffer.from(this.#secretRandomBytes(12));
      const wrapped = sealPasswordDekWrap({
        aad: wrapAad,
        dek: input.dek,
        kek: input.passwordKek,
        nonce: wrapNonce,
      });
      return {
        aadVersion: 1,
        algorithm: "AES-256-GCM",
        ciphertext: sealed.ciphertext,
        createdAt: new Date(),
        dekWrapNonce: wrapped.nonce,
        dekWrapTag: wrapped.tag,
        dekWrapVersion: wrapped.wrapVersion,
        envelopeVersion: input.envelopeVersion,
        kekId: "user-password",
        kekVersion,
        nonce: sealed.nonce,
        secretVersion: input.secretVersion!,
        tag: sealed.tag,
        wrappedDek: wrapped.wrappedDek,
      };
    } finally {
      mainNonce.fill(0);
      wrapNonce?.fill(0);
      aad?.fill(0);
      wrapAad?.fill(0);
    }
  }

  async #openMaterial(input: {
    envelope: CustodyEnvelope;
    passwordKek?: Uint8Array;
    wallet: StoredCustodyWallet;
  }): Promise<{ dek: Buffer; privateKey: Buffer }> {
    const { envelope, wallet } = input;
    const passwordMode = wallet.mode === "user-password";
    let dek: Buffer | null = null;
    let privateKey: Buffer | null = null;
    let aad: Buffer | null = null;
    let wrapAad: Buffer | null = null;
    try {
      if (
        envelope.algorithm !== "AES-256-GCM" ||
        envelope.aadVersion !== 1 ||
        envelope.envelopeVersion !== wallet.envelopeVersion ||
        (wallet.mode !== "server-kek" && wallet.mode !== "user-password")
      ) {
        throw new SignerError(passwordMode ? "INVALID_CREDENTIALS" : "KEYSTORE_CORRUPTED");
      }
      if (passwordMode) {
        if (
          !input.passwordKek ||
          envelope.dekWrapVersion !== 1 ||
          !envelope.dekWrapNonce ||
          !envelope.dekWrapTag ||
          !envelope.secretVersion
        ) {
          throw new SignerError("INVALID_CREDENTIALS");
        }
        wrapAad = buildPasswordDekWrapAad({
          envelopeVersion: envelope.envelopeVersion,
          secretVersion: envelope.secretVersion,
          tenantId: wallet.tenantId,
          userId: wallet.userId,
          walletId: wallet.walletId,
          wrapVersion: 1,
        });
        dek = openPasswordDekWrap({
          aad: wrapAad,
          kek: input.passwordKek,
          nonce: envelope.dekWrapNonce,
          tag: envelope.dekWrapTag,
          wrapVersion: envelope.dekWrapVersion,
          wrappedDek: envelope.wrappedDek,
        });
      } else {
        dek = await this.#kms.unwrapDek(envelope);
      }
      aad = buildWalletAad({
        address: wallet.addressLower,
        envelopeVersion: envelope.envelopeVersion,
        kekVersion: envelope.kekVersion,
        mode: wallet.mode,
        tenantId: wallet.tenantId,
        userId: wallet.userId,
        walletId: wallet.walletId,
      });
      privateKey = openEnvelope({
        aad,
        ciphertext: envelope.ciphertext,
        dek,
        nonce: envelope.nonce,
        tag: envelope.tag,
      });
      const derived = deriveEvmAddress(privateKey);
      if (derived.lowercaseAddress !== wallet.addressLower) {
        throw new SignerError(passwordMode ? "INVALID_CREDENTIALS" : "KEYSTORE_CORRUPTED");
      }
      return { dek, privateKey };
    } catch (error) {
      if (privateKey) this.#zeroize("private-key", privateKey);
      if (dek) this.#zeroize("dek", dek);
      if (passwordMode) throw new SignerError("INVALID_CREDENTIALS");
      throw error;
    } finally {
      aad?.fill(0);
      wrapAad?.fill(0);
    }
  }

  #zeroize(label: ZeroizeLabel, bytes: Uint8Array): void {
    bytes.fill(0);
    this.#onZeroize(label, bytes);
  }
}
