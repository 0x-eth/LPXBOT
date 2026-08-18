import type { Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { KmsClient } from "../apps/signer/src/kms.js";
import type { SignerProductionConfig } from "../apps/signer/src/production-config.js";
import { startSignerRuntime } from "../apps/signer/src/runner.js";
import { SignerError } from "../apps/signer/src/signer-error.js";

const config: SignerProductionConfig = {
  apiToken: "signer-api-token-fixture-at-least-32-bytes",
  ciphertextDatabaseUrl: "postgresql://signer:fixture@127.0.0.1:5432/lpbot",
  host: "127.0.0.1",
  identity: "signer-fixture-01",
  kms: {
    identityToken: "kms-identity-token-fixture-at-least-32-bytes",
    keyId: "custody-fixture",
    keyVersion: "v1",
    url: "https://kms.fixture.invalid",
  },
  port: 0,
};

const runtimes: Array<{ close(): Promise<void> }> = [];

function kmsFixture(overrides: Partial<KmsClient> = {}): KmsClient {
  return {
    activeKey: vi.fn(async () => ({ kekId: "custody-fixture", kekVersion: "v1" })),
    unwrapDek: vi.fn(async () => Buffer.alloc(32)),
    wrapDek: vi.fn(async ({ key }) => ({ ...key, wrappedDek: Buffer.alloc(60) })),
    ...overrides,
  };
}

function poolFixture(tables: Record<string, string | null>) {
  const query = vi.fn(async () => ({ rows: [tables] }));
  const end = vi.fn(async () => undefined);
  return { end, pool: { end, query } as unknown as Pool, query };
}

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()));
});

describe("P04-02 signer production runtime", () => {
  it("does not probe the store or bind when KMS is unavailable", async () => {
    const store = poolFixture({
      auditEvents: "custody_wallet_audit_events",
      envelopes: "custody_wallet_envelopes",
      wallets: "custody_wallets",
    });
    const kms = kmsFixture({
      activeKey: vi.fn(async () => {
        throw new SignerError("SIGNER_UNAVAILABLE", true);
      }),
    });

    await expect(startSignerRuntime(config, { kms, pool: store.pool })).rejects.toMatchObject({
      code: "SIGNER_UNAVAILABLE",
    });
    expect(store.query).not.toHaveBeenCalled();
    expect(store.end).toHaveBeenCalledOnce();
  });

  it("fails closed when the configured KEK version or ciphertext tables are unavailable", async () => {
    const wrongKekStore = poolFixture({
      auditEvents: "custody_wallet_audit_events",
      envelopes: "custody_wallet_envelopes",
      wallets: "custody_wallets",
    });
    await expect(
      startSignerRuntime(config, {
        kms: kmsFixture({
          activeKey: vi.fn(async () => ({ kekId: "custody-fixture", kekVersion: "v2" })),
        }),
        pool: wrongKekStore.pool,
      }),
    ).rejects.toMatchObject({ code: "KEK_VERSION_UNAVAILABLE" });
    expect(wrongKekStore.query).not.toHaveBeenCalled();

    const missingStore = poolFixture({
      auditEvents: "custody_wallet_audit_events",
      envelopes: null,
      wallets: "custody_wallets",
    });
    await expect(
      startSignerRuntime(config, { kms: kmsFixture(), pool: missingStore.pool }),
    ).rejects.toMatchObject({ code: "CUSTODY_STORE_UNAVAILABLE" });
    expect(missingStore.end).toHaveBeenCalledOnce();
  });

  it("binds only after readiness probes and closes the dedicated pool", async () => {
    const store = poolFixture({
      auditEvents: "custody_wallet_audit_events",
      envelopes: "custody_wallet_envelopes",
      wallets: "custody_wallets",
    });
    const runtime = await startSignerRuntime(config, { kms: kmsFixture(), pool: store.pool });
    runtimes.push(runtime);

    const response = await fetch(`${runtime.url}/health`, {
      headers: { Authorization: `Bearer ${config.apiToken}` },
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { capabilities: ["import", "generate", "seal", "open-verify"], ready: true },
      success: true,
    });

    await runtime.close();
    expect(store.end).toHaveBeenCalledOnce();
    runtimes.pop();
  });
});
