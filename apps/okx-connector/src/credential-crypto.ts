import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { OkxConnectorError } from "./errors.js";
import {
  clearCredentialBytes,
  okxCredentialDomain,
  type OkxCredentialAadIdentity,
  type OkxCredentialBytes,
  type OkxCredentialEnvelope,
  type OkxKmsClient,
  type OkxKmsKeyDescriptor,
} from "./types.js";

const dekBytes = 32;
const nonceBytes = 12;
const tagBytes = 16;
const credentialFields = ["apiKey", "secretKey", "passphrase"] as const;

function validSecretLength(value: string): boolean {
  const bytes = Buffer.byteLength(value, "utf8");
  return bytes >= 1 && bytes <= 512 && !/[\u0000-\u001f\u007f]/u.test(value);
}

export function parseCredentialIngress(ingress: Buffer): OkxCredentialBytes {
  let parsed: unknown;
  try {
    parsed = JSON.parse(ingress.toString("utf8"));
  } catch {
    throw new OkxConnectorError("INVALID_CREDENTIAL_INGRESS");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new OkxConnectorError("INVALID_CREDENTIAL_INGRESS");
  }
  const record = parsed as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(",") !== [...credentialFields].sort().join(",") ||
    credentialFields.some(
      (field) => typeof record[field] !== "string" || !validSecretLength(record[field]),
    )
  ) {
    throw new OkxConnectorError("INVALID_CREDENTIAL_INGRESS");
  }
  const credentials = {
    apiKey: Buffer.from(record.apiKey as string, "utf8"),
    passphrase: Buffer.from(record.passphrase as string, "utf8"),
    secretKey: Buffer.from(record.secretKey as string, "utf8"),
  };
  for (const field of credentialFields) record[field] = "";
  return credentials;
}

export function okxCredentialAad(identity: OkxCredentialAadIdentity): Buffer {
  return Buffer.from(
    JSON.stringify({
      credentialId: identity.credentialId,
      domain: okxCredentialDomain,
      environment: identity.environment,
      userId: identity.userId,
      version: identity.version,
    }),
    "utf8",
  );
}

function encodeCredentials(credentials: OkxCredentialBytes): Buffer {
  const fields = credentialFields.map((field) => credentials[field]);
  const total = fields.reduce((size, value) => size + 4 + value.length, 0);
  const output = Buffer.allocUnsafe(total);
  let offset = 0;
  for (const value of fields) {
    output.writeUInt32BE(value.length, offset);
    offset += 4;
    value.copy(output, offset);
    offset += value.length;
  }
  return output;
}

function decodeCredentials(plaintext: Buffer): OkxCredentialBytes {
  const values: Buffer[] = [];
  let offset = 0;
  try {
    for (let index = 0; index < credentialFields.length; index += 1) {
      if (offset + 4 > plaintext.length) throw new Error("invalid length");
      const length = plaintext.readUInt32BE(offset);
      offset += 4;
      if (length < 1 || length > 512 || offset + length > plaintext.length) {
        throw new Error("invalid field");
      }
      values.push(Buffer.from(plaintext.subarray(offset, offset + length)));
      offset += length;
    }
    if (offset !== plaintext.length) throw new Error("trailing bytes");
    return { apiKey: values[0]!, passphrase: values[2]!, secretKey: values[1]! };
  } catch {
    for (const value of values) value.fill(0);
    throw new OkxConnectorError("CREDENTIAL_INTEGRITY_FAILED");
  }
}

export async function encryptOkxCredentials(input: {
  credentials: OkxCredentialBytes;
  identity: OkxCredentialAadIdentity;
  kms: OkxKmsClient;
  now: Date;
}): Promise<OkxCredentialEnvelope> {
  const dek = randomBytes(dekBytes);
  const nonce = randomBytes(nonceBytes);
  const aad = okxCredentialAad(input.identity);
  const plaintext = encodeCredentials(input.credentials);
  try {
    const key = await input.kms.activeKey();
    const cipher = createCipheriv("aes-256-gcm", dek, nonce);
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    const wrappedDek = await input.kms.wrapDek({ dek, key });
    return {
      ...input.identity,
      aadVersion: 1,
      algorithm: "AES-256-GCM",
      ciphertext,
      createdAt: input.now,
      ...key,
      nonce,
      tag,
      wrappedDek,
    };
  } catch (error) {
    if (error instanceof OkxConnectorError) throw error;
    throw new OkxConnectorError("KMS_UNAVAILABLE", true);
  } finally {
    dek.fill(0);
    aad.fill(0);
    plaintext.fill(0);
  }
}

export async function decryptOkxCredentials(
  envelope: OkxCredentialEnvelope,
  kms: OkxKmsClient,
): Promise<OkxCredentialBytes> {
  let dek: Buffer | null = null;
  let plaintext: Buffer | null = null;
  const aad = okxCredentialAad(envelope);
  try {
    if (
      envelope.algorithm !== "AES-256-GCM" ||
      envelope.aadVersion !== 1 ||
      envelope.nonce.length !== nonceBytes ||
      envelope.tag.length !== tagBytes ||
      envelope.wrappedDek.length === 0
    ) {
      throw new OkxConnectorError("CREDENTIAL_INTEGRITY_FAILED");
    }
    dek = await kms.unwrapDek(envelope);
    if (dek.length !== dekBytes) throw new OkxConnectorError("CREDENTIAL_INTEGRITY_FAILED");
    const decipher = createDecipheriv("aes-256-gcm", dek, envelope.nonce);
    decipher.setAAD(aad);
    decipher.setAuthTag(envelope.tag);
    plaintext = Buffer.concat([decipher.update(envelope.ciphertext), decipher.final()]);
    return decodeCredentials(plaintext);
  } catch (error) {
    if (error instanceof OkxConnectorError) throw error;
    throw new OkxConnectorError("CREDENTIAL_INTEGRITY_FAILED");
  } finally {
    dek?.fill(0);
    plaintext?.fill(0);
    aad.fill(0);
  }
}

export class LocalOkxKmsFixture implements OkxKmsClient {
  readonly #descriptor: OkxKmsKeyDescriptor;
  readonly #key: Buffer;
  #allowDecrypt = true;
  #available = true;

  constructor(input?: { kekId?: string; kekVersion?: string; key?: Uint8Array }) {
    this.#descriptor = {
      kekId: input?.kekId ?? "okx-fixture-kek",
      kekVersion: input?.kekVersion ?? "fixture-v1",
    };
    this.#key = input?.key ? Buffer.from(input.key) : randomBytes(32);
    if (this.#key.length !== 32) throw new RangeError("Local fixture KEK must be 32 bytes");
  }

  setAvailable(available: boolean): void {
    this.#available = available;
  }

  setDecryptGrant(allowed: boolean): void {
    this.#allowDecrypt = allowed;
  }

  async activeKey(): Promise<OkxKmsKeyDescriptor> {
    this.#assertAvailable();
    return { ...this.#descriptor };
  }

  async wrapDek(input: { dek: Uint8Array; key: OkxKmsKeyDescriptor }): Promise<Buffer> {
    this.#assertAvailable();
    if (
      input.key.kekId !== this.#descriptor.kekId ||
      input.key.kekVersion !== this.#descriptor.kekVersion
    ) {
      throw new OkxConnectorError("KMS_UNAVAILABLE", true);
    }
    const nonce = randomBytes(nonceBytes);
    const cipher = createCipheriv("aes-256-gcm", this.#key, nonce);
    const ciphertext = Buffer.concat([cipher.update(input.dek), cipher.final()]);
    return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]);
  }

  async unwrapDek(input: OkxKmsKeyDescriptor & { wrappedDek: Uint8Array }): Promise<Buffer> {
    this.#assertAvailable();
    if (!this.#allowDecrypt) throw new OkxConnectorError("KMS_UNAVAILABLE", true);
    if (
      input.kekId !== this.#descriptor.kekId ||
      input.kekVersion !== this.#descriptor.kekVersion ||
      input.wrappedDek.length !== nonceBytes + tagBytes + dekBytes
    ) {
      throw new OkxConnectorError("KMS_UNAVAILABLE", true);
    }
    try {
      const wrapped = Buffer.from(input.wrappedDek);
      const decipher = createDecipheriv("aes-256-gcm", this.#key, wrapped.subarray(0, nonceBytes));
      decipher.setAuthTag(wrapped.subarray(nonceBytes, nonceBytes + tagBytes));
      return Buffer.concat([
        decipher.update(wrapped.subarray(nonceBytes + tagBytes)),
        decipher.final(),
      ]);
    } catch {
      throw new OkxConnectorError("KMS_UNAVAILABLE", true);
    }
  }

  #assertAvailable(): void {
    if (!this.#available) throw new OkxConnectorError("KMS_UNAVAILABLE", true);
  }
}

export function clearEnvelope(envelope: OkxCredentialEnvelope): void {
  envelope.ciphertext.fill(0);
  envelope.nonce.fill(0);
  envelope.tag.fill(0);
  envelope.wrappedDek.fill(0);
}

export function clearCredentials(credentials: OkxCredentialBytes): void {
  clearCredentialBytes(credentials);
}
