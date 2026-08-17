import { MemoryNotificationSecretStore } from "../apps/api/src/notifications.js";
import { describe, expect, it } from "vitest";

describe("P03-04 notification secret read boundary", () => {
  it("reads only an exact owner, purpose, and reference match and fails closed otherwise", async () => {
    const store = new MemoryNotificationSecretStore();
    const stored = await store.put({
      kind: "webhook-hmac",
      secret: "fixture-secret-material-that-never-leaves-this-test",
      userId: "user-a",
    });

    await expect(
      store.read({ kind: "webhook-hmac", secretRef: stored.secretRef, userId: "user-a" }),
    ).resolves.toBe("fixture-secret-material-that-never-leaves-this-test");
    await expect(
      store.read({ kind: "telegram-bot-token", secretRef: stored.secretRef, userId: "user-a" }),
    ).resolves.toBeNull();
    await expect(
      store.read({ kind: "webhook-hmac", secretRef: stored.secretRef, userId: "user-b" }),
    ).resolves.toBeNull();
    await expect(
      store.read({ kind: "webhook-hmac", secretRef: "secret-ref://fixture/missing", userId: "user-a" }),
    ).resolves.toBeNull();

    await store.delete(stored.secretRef);
    await expect(
      store.read({ kind: "webhook-hmac", secretRef: stored.secretRef, userId: "user-a" }),
    ).resolves.toBeNull();
  });
});
