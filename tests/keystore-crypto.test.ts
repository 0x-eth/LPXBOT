import { readFile } from "node:fs/promises";

import {
  buildPasswordDekWrapAad,
  createPasswordVerifier,
  deriveArgon2idKek,
  openPasswordDekWrap,
  passwordKdfV1,
  sealPasswordDekWrap,
} from "../apps/signer/src/password-crypto.js";
import { describe, expect, it } from "vitest";

interface ArgonFixture {
  expected: { derivedKeyHex: string };
  input: {
    parameters: {
      argonVersion: number;
      iterations: number;
      memoryKiB: number;
      outputBytes: number;
      parallelism: number;
    };
    passwordUtf8: string;
    saltHex: string;
  };
}

describe("P04-03 password cryptography", () => {
  it("replays the frozen P04-01 Argon2id known answer", async () => {
    const fixture = JSON.parse(
      await readFile("artifacts/acceptance/P04-01/fixtures/argon2id-known-answer.json", "utf8"),
    ) as ArgonFixture;
    const password = Buffer.from(fixture.input.passwordUtf8, "utf8");
    const salt = Buffer.from(fixture.input.saltHex, "hex");
    const derived = deriveArgon2idKek(password, salt, {
      argonVersion: fixture.input.parameters.argonVersion,
      iterations: fixture.input.parameters.iterations,
      memoryKiB: fixture.input.parameters.memoryKiB,
      outputBytes: fixture.input.parameters.outputBytes,
      parallelism: fixture.input.parameters.parallelism,
    });
    try {
      expect(derived.toString("hex")).toBe(fixture.expected.derivedKeyHex);
    } finally {
      password.fill(0);
      derived.fill(0);
    }
  });

  it("freezes Argon2id v1 at 64 MiB, three passes, one lane, 16-byte salt and 32-byte output", () => {
    expect(passwordKdfV1).toEqual({
      algorithm: "Argon2id",
      argonVersion: 19,
      iterations: 3,
      memoryKiB: 65_536,
      outputBytes: 32,
      parallelism: 1,
      parameterVersion: 1,
      saltBytes: 16,
    });
  });

  it("authenticates a versioned verifier and independently wrapped wallet DEK", () => {
    const kek = Buffer.alloc(32, 0x41);
    const dek = Buffer.alloc(32, 0x52);
    const aad = buildPasswordDekWrapAad({
      envelopeVersion: 7,
      secretVersion: 3,
      tenantId: "tenant-fixture-01",
      userId: "43000000-0000-4000-8000-000000000001",
      walletId: "43000000-0000-4000-8000-000000000011",
      wrapVersion: 1,
    });
    const verifier = createPasswordVerifier(kek, {
      secretVersion: 3,
      userId: "43000000-0000-4000-8000-000000000001",
    });
    const wrapped = sealPasswordDekWrap({ aad, dek, kek, nonce: Buffer.alloc(12, 0x63) });
    const opened = openPasswordDekWrap({ ...wrapped, aad, kek });
    try {
      expect(verifier).toHaveLength(32);
      expect(wrapped.wrapVersion).toBe(1);
      expect(wrapped.nonce).toHaveLength(12);
      expect(wrapped.tag).toHaveLength(16);
      expect(wrapped.wrappedDek).toHaveLength(32);
      expect(opened).toEqual(dek);
      expect(() =>
        openPasswordDekWrap({ ...wrapped, aad: Buffer.from(`${aad.toString()}-changed`), kek }),
      ).toThrowError("INVALID_CREDENTIALS");
    } finally {
      aad.fill(0);
      dek.fill(0);
      kek.fill(0);
      opened.fill(0);
      verifier.fill(0);
    }
  });
});
