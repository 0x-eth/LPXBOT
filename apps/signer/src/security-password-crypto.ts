import { createHmac } from "node:crypto";

import type { PasswordKdfParameters } from "./password-crypto.js";
import { deriveArgon2idKek, passwordKdfV1 } from "./password-crypto.js";
import { SignerError } from "./signer-error.js";

const securityPasswordKdfDomain = Buffer.from("lpbot-security-password-kdf/v1\0", "utf8");
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export const securityPasswordKdfV1 = Object.freeze({
  ...passwordKdfV1,
  domain: "lpbot-security-password-kdf/v1" as const,
});

export function deriveSecurityPasswordKey(
  password: Uint8Array,
  salt: Uint8Array,
  parameters: PasswordKdfParameters = securityPasswordKdfV1,
): Buffer {
  const domainInput = Buffer.concat([securityPasswordKdfDomain, password]);
  try {
    return deriveArgon2idKek(domainInput, salt, parameters);
  } finally {
    domainInput.fill(0);
  }
}

export function createSecurityPasswordVerifier(
  key: Uint8Array,
  input: { userId: string; version: number },
): Buffer {
  if (
    key.length !== 32 ||
    !uuidPattern.test(input.userId) ||
    !Number.isSafeInteger(input.version) ||
    input.version < 1
  ) {
    throw new SignerError("INVALID_CREDENTIALS");
  }
  const message = Buffer.from(
    ["lpbot-security-password-verifier/v1", input.userId, String(input.version)].join("\n"),
    "utf8",
  );
  try {
    return createHmac("sha256", key).update(message).digest();
  } finally {
    message.fill(0);
  }
}
