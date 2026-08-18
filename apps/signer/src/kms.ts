import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { SignerError } from "./signer-error.js";

export interface KmsKeyDescriptor {
  kekId: string;
  kekVersion: string;
}

export interface WrappedDek extends KmsKeyDescriptor {
  wrappedDek: Buffer;
}

export interface KmsClient {
  activeKey(): Promise<KmsKeyDescriptor>;
  unwrapDek(input: WrappedDek): Promise<Buffer>;
  wrapDek(input: { dek: Uint8Array; key: KmsKeyDescriptor }): Promise<WrappedDek>;
}

export class LocalKmsFixture implements KmsClient {
  readonly #activeVersion: string;
  readonly #kekId: string;
  readonly #keys: Map<string, Buffer>;
  #available = true;

  constructor(input: { activeVersion: string; kekId?: string; keys: Record<string, Uint8Array> }) {
    this.#activeVersion = input.activeVersion;
    this.#kekId = input.kekId ?? "local-fixture";
    this.#keys = new Map(
      Object.entries(input.keys).map(([version, key]) => {
        if (key.length !== 32) throw new TypeError("Local KMS fixture KEKs must be 32 bytes");
        return [version, Buffer.from(key)];
      }),
    );
  }

  setAvailable(available: boolean): void {
    this.#available = available;
  }

  async activeKey(): Promise<KmsKeyDescriptor> {
    this.#assertAvailable();
    if (!this.#keys.has(this.#activeVersion)) throw new SignerError("KEK_VERSION_UNAVAILABLE");
    return { kekId: this.#kekId, kekVersion: this.#activeVersion };
  }

  async wrapDek(input: { dek: Uint8Array; key: KmsKeyDescriptor }): Promise<WrappedDek> {
    this.#assertAvailable();
    if (input.dek.length !== 32) throw new SignerError("SIGNER_UNAVAILABLE", true);
    const key = this.#key(input.key);
    const nonce = randomBytes(12);
    try {
      const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 });
      cipher.setAAD(this.#aad(input.key));
      const ciphertext = Buffer.concat([cipher.update(input.dek), cipher.final()]);
      return {
        ...input.key,
        wrappedDek: Buffer.concat([nonce, ciphertext, cipher.getAuthTag()]),
      };
    } finally {
      key.fill(0);
      nonce.fill(0);
    }
  }

  async unwrapDek(input: WrappedDek): Promise<Buffer> {
    this.#assertAvailable();
    if (input.wrappedDek.length !== 60) throw new SignerError("KEYSTORE_CORRUPTED");
    const key = this.#key(input);
    const nonce = input.wrappedDek.subarray(0, 12);
    const ciphertext = input.wrappedDek.subarray(12, 44);
    const tag = input.wrappedDek.subarray(44, 60);
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 });
      decipher.setAAD(this.#aad(input));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } catch (error) {
      if (error instanceof SignerError) throw error;
      throw new SignerError("KEYSTORE_CORRUPTED");
    } finally {
      key.fill(0);
    }
  }

  #aad(input: KmsKeyDescriptor): Buffer {
    return Buffer.from(`lpbot-dek-wrap/v1\n${input.kekId}\n${input.kekVersion}`, "utf8");
  }

  #assertAvailable(): void {
    if (!this.#available) throw new SignerError("SIGNER_UNAVAILABLE", true);
  }

  #key(input: KmsKeyDescriptor): Buffer {
    if (input.kekId !== this.#kekId) throw new SignerError("KEK_VERSION_UNAVAILABLE");
    const key = this.#keys.get(input.kekVersion);
    if (!key) throw new SignerError("KEK_VERSION_UNAVAILABLE");
    return Buffer.from(key);
  }
}
