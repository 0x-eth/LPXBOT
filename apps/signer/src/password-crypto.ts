import { createCipheriv, createDecipheriv, createHmac } from "node:crypto";

import { argon2id } from "@noble/hashes/argon2";

import { SignerError } from "./signer-error.js";

export interface PasswordKdfParameters {
  argonVersion: number;
  iterations: number;
  memoryKiB: number;
  outputBytes: number;
  parallelism: number;
}

export const passwordKdfV1 = Object.freeze({
  algorithm: "Argon2id" as const,
  argonVersion: 19,
  iterations: 3,
  memoryKiB: 65_536,
  outputBytes: 32,
  parallelism: 1,
  parameterVersion: 1 as const,
  saltBytes: 16,
});

const identifierPattern = /^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$/u;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function positiveInteger(value: number): string {
  if (!Number.isSafeInteger(value) || value < 1) throw new SignerError("INVALID_WALLET");
  return String(value);
}

function identifier(value: string, uuid = false): string {
  if (!(uuid ? uuidPattern : identifierPattern).test(value)) {
    throw new SignerError("INVALID_WALLET");
  }
  return value;
}

export function deriveArgon2idKek(
  password: Uint8Array,
  salt: Uint8Array,
  parameters: PasswordKdfParameters = passwordKdfV1,
): Buffer {
  if (
    salt.length !== passwordKdfV1.saltBytes ||
    password.length < 1 ||
    parameters.argonVersion !== 19 ||
    !Number.isSafeInteger(parameters.iterations) ||
    parameters.iterations < 1 ||
    !Number.isSafeInteger(parameters.memoryKiB) ||
    parameters.memoryKiB < 8 * parameters.parallelism ||
    !Number.isSafeInteger(parameters.outputBytes) ||
    parameters.outputBytes < 16 ||
    !Number.isSafeInteger(parameters.parallelism) ||
    parameters.parallelism < 1
  ) {
    throw new SignerError("INVALID_CREDENTIALS");
  }
  try {
    return Buffer.from(
      argon2id(password, salt, {
        dkLen: parameters.outputBytes,
        m: parameters.memoryKiB,
        p: parameters.parallelism,
        t: parameters.iterations,
        version: parameters.argonVersion,
      }),
    );
  } catch {
    throw new SignerError("INVALID_CREDENTIALS");
  }
}

export function createPasswordVerifier(
  kek: Uint8Array,
  input: { secretVersion: number; userId: string },
): Buffer {
  if (kek.length !== 32) throw new SignerError("INVALID_CREDENTIALS");
  const message = Buffer.from(
    [
      "lpbot-keystore-password-verifier/v1",
      identifier(input.userId, true),
      positiveInteger(input.secretVersion),
    ].join("\n"),
    "utf8",
  );
  try {
    return createHmac("sha256", kek).update(message).digest();
  } finally {
    message.fill(0);
  }
}

export function buildPasswordDekWrapAad(input: {
  envelopeVersion: number;
  secretVersion: number;
  tenantId: string;
  userId: string;
  walletId: string;
  wrapVersion: 1;
}): Buffer {
  if (input.wrapVersion !== 1) throw new SignerError("INVALID_WALLET");
  return Buffer.from(
    [
      "lpbot-wallet-dek-wrap/v1",
      identifier(input.tenantId),
      identifier(input.userId, true),
      identifier(input.walletId, true),
      positiveInteger(input.envelopeVersion),
      positiveInteger(input.secretVersion),
      String(input.wrapVersion),
    ].join("\n"),
    "utf8",
  );
}

export interface PasswordDekWrap {
  nonce: Buffer;
  tag: Buffer;
  wrapVersion: 1;
  wrappedDek: Buffer;
}

export function sealPasswordDekWrap(input: {
  aad: Uint8Array;
  dek: Uint8Array;
  kek: Uint8Array;
  nonce: Uint8Array;
}): PasswordDekWrap {
  if (input.dek.length !== 32 || input.kek.length !== 32 || input.nonce.length !== 12) {
    throw new SignerError("SIGNER_UNAVAILABLE", true);
  }
  const cipher = createCipheriv("aes-256-gcm", input.kek, input.nonce, { authTagLength: 16 });
  cipher.setAAD(input.aad);
  return {
    nonce: Buffer.from(input.nonce),
    tag: cipher.getAuthTag(),
    wrapVersion: 1,
    wrappedDek: Buffer.concat([cipher.update(input.dek), cipher.final()]),
  };
}

export function openPasswordDekWrap(
  input: PasswordDekWrap & { aad: Uint8Array; kek: Uint8Array },
): Buffer {
  if (
    input.wrapVersion !== 1 ||
    input.kek.length !== 32 ||
    input.nonce.length !== 12 ||
    input.tag.length !== 16 ||
    input.wrappedDek.length !== 32
  ) {
    throw new SignerError("INVALID_CREDENTIALS");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", input.kek, input.nonce, {
      authTagLength: 16,
    });
    decipher.setAAD(input.aad);
    decipher.setAuthTag(input.tag);
    return Buffer.concat([decipher.update(input.wrappedDek), decipher.final()]);
  } catch {
    throw new SignerError("INVALID_CREDENTIALS");
  }
}
