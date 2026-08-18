import { randomBytes as systemRandomBytes } from "node:crypto";

import type { CustodyEnvelope, StoredCustodyWallet } from "./custody-types.js";
import type { KmsClient } from "./kms.js";
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

export const signerCapabilities = ["import", "generate", "seal", "open-verify"] as const;

export interface SealedWalletDraft {
  address: `0x${string}`;
  addressLower: `0x${string}`;
  envelope: CustodyEnvelope;
  mode: "server-kek";
  name: string;
}

interface SecretImportBody {
  mode: "server-kek";
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
    if (
      Object.keys(record).some((key) => !["mode", "name", "privateKey"].includes(key)) ||
      !Object.hasOwn(record, "privateKey")
    ) {
      throw new SignerError("INVALID_PRIVATE_KEY");
    }
    if (record.mode !== "server-kek") throw new SignerError("INVALID_MODE");
    return {
      mode: "server-kek",
      name: privateKeyInputName(record.name),
      privateKey: typeof record.privateKey === "string" ? record.privateKey : "",
    };
  } catch (error) {
    if (error instanceof SignerError) throw error;
    throw new SignerError("INVALID_PRIVATE_KEY");
  }
}

export class IsolatedWalletSigner {
  readonly #kms: KmsClient;
  readonly #onZeroize: (label: "dek" | "ingress" | "private-key", bytes: Uint8Array) => void;
  readonly #privateKeyRandomBytes: (length: number) => Uint8Array;
  readonly #secretRandomBytes: (length: number) => Uint8Array;

  constructor(input: {
    kms: KmsClient;
    onZeroize?: (label: "dek" | "ingress" | "private-key", bytes: Uint8Array) => void;
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
    mode: "server-kek";
    name: string;
    tenantId: string;
    userId: string;
    walletId: string;
  }): Promise<SealedWalletDraft> {
    if (input.mode !== "server-kek") throw new SignerError("INVALID_MODE");
    const privateKey = generatePrivateKey(this.#privateKeyRandomBytes);
    try {
      return await this.seal({ ...input, name: privateKeyInputName(input.name), privateKey });
    } finally {
      this.#zeroize("private-key", privateKey);
    }
  }

  async seal(input: {
    envelopeVersion: number;
    mode: "server-kek";
    name: string;
    privateKey: Uint8Array;
    tenantId: string;
    userId: string;
    walletId: string;
  }): Promise<SealedWalletDraft> {
    if (input.mode !== "server-kek") throw new SignerError("INVALID_MODE");
    const address = deriveEvmAddress(input.privateKey);
    const key = await this.#kms.activeKey();
    const aad = buildWalletAad({
      address: address.lowercaseAddress,
      envelopeVersion: input.envelopeVersion,
      kekVersion: key.kekVersion,
      tenantId: input.tenantId,
      userId: input.userId,
      walletId: input.walletId,
    });
    const dek = Buffer.from(this.#secretRandomBytes(32));
    const nonce = Buffer.from(this.#secretRandomBytes(12));
    if (dek.length !== 32 || nonce.length !== 12) {
      dek.fill(0);
      nonce.fill(0);
      throw new SignerError("SIGNER_UNAVAILABLE", true);
    }
    try {
      const sealed = sealEnvelope({ aad, dek, nonce, plaintext: input.privateKey });
      const wrapped = await this.#kms.wrapDek({ dek, key });
      return {
        address: address.checksumAddress,
        addressLower: address.lowercaseAddress,
        envelope: {
          aadVersion: 1,
          algorithm: "AES-256-GCM",
          ciphertext: sealed.ciphertext,
          createdAt: new Date(),
          envelopeVersion: input.envelopeVersion,
          kekId: wrapped.kekId,
          kekVersion: wrapped.kekVersion,
          nonce: sealed.nonce,
          tag: sealed.tag,
          wrappedDek: wrapped.wrappedDek,
        },
        mode: "server-kek",
        name: input.name,
      };
    } finally {
      nonce.fill(0);
      aad.fill(0);
      this.#zeroize("dek", dek);
    }
  }

  async openAndVerify(input: {
    envelope: CustodyEnvelope;
    wallet: StoredCustodyWallet;
  }): Promise<{ address: `0x${string}`; verified: true }> {
    const { envelope, wallet } = input;
    if (
      envelope.algorithm !== "AES-256-GCM" ||
      envelope.aadVersion !== 1 ||
      envelope.envelopeVersion !== wallet.envelopeVersion ||
      wallet.mode !== "server-kek"
    ) {
      throw new SignerError("KEYSTORE_CORRUPTED");
    }
    const dek = await this.#kms.unwrapDek(envelope);
    let privateKey: Buffer | null = null;
    const aad = buildWalletAad({
      address: wallet.addressLower,
      envelopeVersion: envelope.envelopeVersion,
      kekVersion: envelope.kekVersion,
      tenantId: wallet.tenantId,
      userId: wallet.userId,
      walletId: wallet.walletId,
    });
    try {
      privateKey = openEnvelope({
        aad,
        ciphertext: envelope.ciphertext,
        dek,
        nonce: envelope.nonce,
        tag: envelope.tag,
      });
      const derived = deriveEvmAddress(privateKey);
      if (derived.lowercaseAddress !== wallet.addressLower) {
        throw new SignerError("KEYSTORE_CORRUPTED");
      }
      return { address: derived.checksumAddress, verified: true };
    } finally {
      aad.fill(0);
      if (privateKey) this.#zeroize("private-key", privateKey);
      this.#zeroize("dek", dek);
    }
  }

  #zeroize(label: "dek" | "ingress" | "private-key", bytes: Uint8Array): void {
    bytes.fill(0);
    this.#onZeroize(label, bytes);
  }
}
