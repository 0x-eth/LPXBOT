import type { Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { KmsClient } from "../apps/signer/src/kms.js";
import { CustodySignerService } from "../apps/signer/src/custody-signer-service.js";
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

const readyTables = {
  auditEvents: "custody_wallet_audit_events",
  deletePreviews: "custody_wallet_delete_previews",
  envelopes: "custody_wallet_envelopes",
  failures: "user_keystore_failures",
  keystoreVersions: "user_keystore_versions",
  keystores: "user_keystores",
  resetPreviews: "user_keystore_reset_previews",
  securityPasswordAudits: "security_password_audit_events",
  securityPasswordVersions: "user_security_password_versions",
  securityPasswords: "user_security_passwords",
  tombstones: "custody_wallet_tombstones",
  wallets: "custody_wallets",
};

function lifecyclePoolFixture() {
  const walletId = "54000000-0000-4000-8000-000000000011";
  const userId = "54000000-0000-4000-8000-000000000001";
  const walletRow = {
    address: "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf",
    address_lower: "0x7e5f4552091a69125d5dfcb7b8c2659029395bdf",
    created_at: new Date("2026-08-18T05:00:00.000Z"),
    current_envelope_version: 1,
    lock_status: "ready",
    mode: "server-kek",
    name: "Runtime fixture",
    revision: "1",
    tenant_id: "tenant-fixture-01",
    updated_at: new Date("2026-08-18T05:00:00.000Z"),
    user_id: userId,
    wallet_id: walletId,
  };
  const client = {
    query: vi.fn(async (sql: string) =>
      sql.includes("SELECT 1 FROM custody_wallets")
        ? { rowCount: 1, rows: [{ "?column?": 1 }] }
        : { rowCount: 0, rows: [] },
    ),
    release: vi.fn(),
  };
  const query = vi.fn(async (sql: string) =>
    sql.includes("to_regclass")
      ? { rows: [readyTables] }
      : sql.includes("FROM custody_wallets")
        ? { rows: [walletRow] }
        : { rows: [] },
  );
  const end = vi.fn(async () => undefined);
  return {
    end,
    pool: { connect: async () => client, end, query } as unknown as Pool,
    userId,
    walletId,
  };
}

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()));
});

describe("P04-02 signer production runtime", () => {
  it("does not probe the store or bind when KMS is unavailable", async () => {
    const store = poolFixture(readyTables);
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
    const wrongKekStore = poolFixture(readyTables);
    await expect(
      startSignerRuntime(config, {
        kms: kmsFixture({
          activeKey: vi.fn(async () => ({ kekId: "custody-fixture", kekVersion: "v2" })),
        }),
        pool: wrongKekStore.pool,
      }),
    ).rejects.toMatchObject({ code: "KEK_VERSION_UNAVAILABLE" });
    expect(wrongKekStore.query).not.toHaveBeenCalled();

    const missingStore = poolFixture({ ...readyTables, envelopes: null });
    await expect(
      startSignerRuntime(config, { kms: kmsFixture(), pool: missingStore.pool }),
    ).rejects.toMatchObject({ code: "CUSTODY_STORE_UNAVAILABLE" });
    expect(missingStore.end).toHaveBeenCalledOnce();

    const missingKeystoreStore = poolFixture({ ...readyTables, keystoreVersions: null });
    await expect(
      startSignerRuntime(config, { kms: kmsFixture(), pool: missingKeystoreStore.pool }),
    ).rejects.toMatchObject({ code: "CUSTODY_STORE_UNAVAILABLE" });
    expect(missingKeystoreStore.end).toHaveBeenCalledOnce();

    const missingLifecycleStore = poolFixture({ ...readyTables, tombstones: null });
    await expect(
      startSignerRuntime(config, { kms: kmsFixture(), pool: missingLifecycleStore.pool }),
    ).rejects.toMatchObject({ code: "CUSTODY_STORE_UNAVAILABLE" });
    expect(missingLifecycleStore.end).toHaveBeenCalledOnce();
  });

  it("binds only after readiness probes and closes the dedicated pool", async () => {
    const store = poolFixture(readyTables);
    const shutdown = vi.spyOn(CustodySignerService.prototype, "shutdown");
    const runtime = await startSignerRuntime(config, { kms: kmsFixture(), pool: store.pool });
    runtimes.push(runtime);

    const response = await fetch(`${runtime.url}/health`, {
      headers: { Authorization: `Bearer ${config.apiToken}` },
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        capabilities: [
          "import",
          "generate",
          "seal",
          "open-verify",
          "password-reseal",
          "keystore-unlock",
          "keystore-auto-lock",
        ],
        ready: true,
      },
      success: true,
    });

    await runtime.close();
    expect(shutdown).toHaveBeenCalledOnce();
    expect(shutdown.mock.invocationCallOrder[0]).toBeLessThan(
      store.end.mock.invocationCallOrder[0]!,
    );
    expect(store.end).toHaveBeenCalledOnce();
    runtimes.pop();
  });
});

describe("P04-04 signer lifecycle runtime wiring", () => {
  it("passes an injected authoritative inventory into the signer service", async () => {
    const store = lifecyclePoolFixture();
    const inventory = {
      inspect: vi.fn(async () => ({
        assetIds: [],
        assetRiskDigest: "sha256:runtime-empty",
        complete: true,
        policyIds: [],
        positionIds: [],
        taskIds: [],
      })),
    };
    const runtime = await startSignerRuntime(config, {
      kms: kmsFixture(),
      pool: store.pool,
      walletDependencyInventory: inventory,
    });
    runtimes.push(runtime);

    const response = await fetch(`${runtime.url}/v1/wallets/${store.walletId}/delete-preview`, {
      headers: {
        Authorization: `Bearer ${config.apiToken}`,
        "X-LPBOT-Tenant-Id": "tenant-fixture-01",
        "X-LPBOT-User-Id": store.userId,
      },
      method: "POST",
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        assetCount: 0,
        assetRiskDigest: "sha256:runtime-empty",
        forceEligible: true,
        walletId: store.walletId,
      },
      success: true,
    });
    expect(inventory.inspect).toHaveBeenCalledWith({
      userId: store.userId,
      walletId: store.walletId,
    });
  });
});
