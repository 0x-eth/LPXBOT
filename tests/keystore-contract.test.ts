import {
  keystoreAutoLockMinutes,
  keystoreContracts,
  keystoreResetConfirmationPhrase,
  keystoreSecretMediaType,
  type ChangeKeystorePasswordRequest,
  type ChangeWalletEncryptionModeRequest,
  type CreateKeystorePasswordRequest,
  type KeystoreResetRequest,
  type KeystoreStatus,
  type UnlockKeystoreRequest,
} from "../packages/api-contract/src/index.js";
import { describe, expect, expectTypeOf, it } from "vitest";

describe("P04-03 public Keystore contract", () => {
  it("declares all Keystore and encryption-mode endpoints", () => {
    expect(keystoreContracts).toEqual({
      autoLock: { method: "PATCH", path: "/api/keystore/auto-lock" },
      createPassword: { method: "POST", path: "/api/keystore/password" },
      lock: { method: "POST", path: "/api/keystore/lock" },
      reset: { method: "POST", path: "/api/keystore/reset" },
      resetPreview: { method: "GET", path: "/api/keystore/reset-preview" },
      status: { method: "GET", path: "/api/keystore/status" },
      switchWalletMode: {
        method: "POST",
        path: "/api/wallets/{walletId}/encryption-mode",
      },
      unlock: { method: "POST", path: "/api/keystore/unlock" },
      updatePassword: { method: "PUT", path: "/api/keystore/password" },
    });
    expect(keystoreAutoLockMinutes).toEqual([1, 5, 15, 30, 60]);
    expect(keystoreResetConfirmationPhrase).toBe("I_LOSE_ALL_PASSWORD_WALLETS");
    expect(keystoreSecretMediaType).toBe("application/vnd.lpbot.keystore-secret+json");
  });

  it("keeps secret request DTOs separate from the strict public status DTO", () => {
    const create = { newPassword: "synthetic-password" } satisfies CreateKeystorePasswordRequest;
    const change = {
      expectedVersion: 1,
      newPassword: "synthetic-password-two",
      oldPassword: "synthetic-password-one",
    } satisfies ChangeKeystorePasswordRequest;
    const unlock = { password: "synthetic-password" } satisfies UnlockKeystoreRequest;
    const reset = {
      confirmationPhrase: "I_LOSE_ALL_PASSWORD_WALLETS",
      expectedVersion: 1,
      previewToken: "preview-token-fixture",
    } satisfies KeystoreResetRequest;
    const switchMode = {
      expectedRevision: 1,
      expectedSecretVersion: 1,
      mode: "user-password",
      password: "synthetic-password",
    } satisfies ChangeWalletEncryptionModeRequest;
    const status = {
      configured: true,
      status: "locked",
      version: 1,
    } satisfies KeystoreStatus;

    expectTypeOf(create.newPassword).toBeString();
    expectTypeOf(change.expectedVersion).toBeNumber();
    expectTypeOf(unlock.password).toBeString();
    expectTypeOf(reset.confirmationPhrase).toEqualTypeOf<"I_LOSE_ALL_PASSWORD_WALLETS">();
    expectTypeOf(switchMode.mode).toEqualTypeOf<"user-password">();
    expect(Object.keys(status).sort()).toEqual(["configured", "status", "version"]);
  });
});
