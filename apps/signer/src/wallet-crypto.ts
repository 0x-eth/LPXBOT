import { createCipheriv, createDecipheriv, randomBytes as systemRandomBytes } from "node:crypto";

import { getAddress, type Hex } from "viem";
import { privateKeyToAddress } from "viem/accounts";

import { SignerError } from "./signer-error.js";

export const SECP256K1_ORDER = BigInt(
  "0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141",
);

const privateKeyPattern = /^(?:0x)?[0-9a-fA-F]{64}$/u;
const lowercaseIdentifierPattern = /^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$/u;
const lowercaseAddressPattern = /^0x[0-9a-f]{40}$/u;

function isValidScalar(bytes: Uint8Array): boolean {
  const scalar = BigInt(`0x${Buffer.from(bytes).toString("hex")}`);
  return scalar > 0n && scalar < SECP256K1_ORDER;
}

export function parsePrivateKey(value: unknown): Buffer {
  if (typeof value !== "string" || !privateKeyPattern.test(value)) {
    throw new SignerError("INVALID_PRIVATE_KEY");
  }
  const bytes = Buffer.from(value.startsWith("0x") ? value.slice(2) : value, "hex");
  if (bytes.length !== 32 || !isValidScalar(bytes)) {
    bytes.fill(0);
    throw new SignerError("INVALID_PRIVATE_KEY");
  }
  return bytes;
}

export function generatePrivateKey(
  randomBytes: (length: number) => Uint8Array = systemRandomBytes,
): Buffer {
  for (;;) {
    const candidate = Buffer.from(randomBytes(32));
    if (candidate.length !== 32) {
      candidate.fill(0);
      throw new SignerError("SIGNER_UNAVAILABLE", true);
    }
    if (isValidScalar(candidate)) return candidate;
    candidate.fill(0);
  }
}

export function deriveEvmAddress(privateKey: Uint8Array): {
  checksumAddress: `0x${string}`;
  lowercaseAddress: `0x${string}`;
} {
  if (privateKey.length !== 32 || !isValidScalar(privateKey)) {
    throw new SignerError("INVALID_PRIVATE_KEY");
  }
  const address = privateKeyToAddress(`0x${Buffer.from(privateKey).toString("hex")}` as Hex);
  return {
    checksumAddress: getAddress(address),
    lowercaseAddress: address.toLowerCase() as `0x${string}`,
  };
}

function canonicalIdentifier(value: string): string {
  if (!lowercaseIdentifierPattern.test(value)) throw new SignerError("INVALID_WALLET");
  return value;
}

export function buildWalletAad(input: {
  address: string;
  envelopeVersion: number;
  kekVersion: string;
  tenantId: string;
  userId: string;
  walletId: string;
}): Buffer {
  if (!lowercaseAddressPattern.test(input.address)) throw new SignerError("INVALID_WALLET");
  if (!Number.isSafeInteger(input.envelopeVersion) || input.envelopeVersion < 1) {
    throw new SignerError("INVALID_WALLET");
  }
  const fields = [
    "lpbot-wallet-envelope/v1",
    canonicalIdentifier(input.tenantId),
    canonicalIdentifier(input.userId),
    canonicalIdentifier(input.walletId),
    input.address,
    "server",
    String(input.envelopeVersion),
    canonicalIdentifier(input.kekVersion),
  ];
  return Buffer.from(fields.join("\n"), "utf8");
}

export interface SealedBytes {
  ciphertext: Buffer;
  nonce: Buffer;
  tag: Buffer;
}

export function sealEnvelope(input: {
  aad: Uint8Array;
  dek: Uint8Array;
  nonce: Uint8Array;
  plaintext: Uint8Array;
}): SealedBytes {
  if (input.dek.length !== 32 || input.nonce.length !== 12) {
    throw new SignerError("SIGNER_UNAVAILABLE", true);
  }
  const cipher = createCipheriv("aes-256-gcm", input.dek, input.nonce, { authTagLength: 16 });
  cipher.setAAD(input.aad);
  return {
    ciphertext: Buffer.concat([cipher.update(input.plaintext), cipher.final()]),
    nonce: Buffer.from(input.nonce),
    tag: cipher.getAuthTag(),
  };
}

export function openEnvelope(input: SealedBytes & { aad: Uint8Array; dek: Uint8Array }): Buffer {
  if (
    input.dek.length !== 32 ||
    input.nonce.length !== 12 ||
    input.tag.length !== 16 ||
    input.ciphertext.length !== 32
  ) {
    throw new SignerError("KEYSTORE_CORRUPTED");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", input.dek, input.nonce, {
      authTagLength: 16,
    });
    decipher.setAAD(input.aad);
    decipher.setAuthTag(input.tag);
    return Buffer.concat([decipher.update(input.ciphertext), decipher.final()]);
  } catch {
    throw new SignerError("KEYSTORE_CORRUPTED");
  }
}

export function privateKeyInputName(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 80 ||
    value.trim() !== value
  ) {
    throw new SignerError("INVALID_WALLET");
  }
  if (/\p{Cc}/u.test(value)) throw new SignerError("INVALID_WALLET");
  return value;
}
