import type { Server } from "node:http";

import type { Pool } from "pg";
import {
  buildWalletHelperV2DeploymentMaterial,
  P05_HELPER_DEPLOYMENT_REGISTRY,
  P05_LOCAL_HELPER_UPGRADE_REGISTRY,
} from "../packages/chain-registry/src/index.js";
import {
  localHelperUpgradePlanDigest,
  localHelperUpgradeSelectorSetHash,
  type LocalHelperUpgradePlan,
} from "../packages/domain/src/local-helper-upgrade.js";
import {
  IsolatedWalletSigner,
  LocalKmsFixture,
  PostgresLocalHelperUpgradePlanAuthorizer,
  type LocalHelperUpgradePlanChainVerification,
  type StoredCustodyWallet,
} from "../apps/signer/src/index.js";
import type { CustodySignerService } from "../apps/signer/src/custody-signer-service.js";
import { createSignerHttpServer } from "../apps/signer/src/http-server.js";
import { LoopbackLocalHelperUpgradeSignerGateway } from "../apps/worker/src/index.js";
import { getContractAddress, keccak256, parseTransaction, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterEach, describe, expect, it, vi } from "vitest";

const privateKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const owner = privateKeyToAccount(privateKey).address.toLowerCase() as `0x${string}`;
const tenantId = "helper-upgrade-signer";
const userId = "9e090000-0000-4000-8000-000000000001";
const walletId = "9e090000-0000-4000-8000-000000000002";
const operationId = "9e090000-0000-4000-8000-000000000003";
const bindingId = "9e090000-0000-4000-8000-000000000004";
const sessionId = "9e090000-0000-4000-8000-000000000006";
const apiToken = "local-helper-upgrade-signer-token-at-least-32-bytes";
const sourceHelper = `0x${"22".repeat(20)}` as const;
const sourceRuntime = `0x${"33".repeat(32)}` as const;
const deployedRuntime = "0x6000" as const;
const expectedRuntime = keccak256(deployedRuntime);
const now = new Date("2026-08-21T03:00:00.000Z");
const servers: Server[] = [];

function plan(): LocalHelperUpgradePlan {
  const registry = P05_LOCAL_HELPER_UPGRADE_REGISTRY;
  const material = buildWalletHelperV2DeploymentMaterial(owner, registry);
  const value: LocalHelperUpgradePlan = {
    chainId: 31_337,
    deadline: new Date(now.getTime() + 10 * 60_000).toISOString(),
    feeLimit: {
      feeCapBaseUnit: "4000000",
      gasLimit: "1000000",
      maxFeePerGasBaseUnit: "4",
      maxPriorityFeePerGasBaseUnit: "2",
    },
    fencingToken: "11",
    nonce: "7",
    operationId,
    planDigest: `sha256:${"00".repeat(32)}`,
    planVersion: "p05-local-helper-upgrade-plan-v3",
    registry: {
      digest: registry.registryDigest,
      rollbackVersion: registry.rollbackVersion,
      version: registry.registryVersion,
    },
    schemaVersion: 3,
    snapshot: {
      blockHash: `0x${"44".repeat(32)}`,
      blockNumber: "10",
      digest: `sha256:${"55".repeat(32)}`,
    },
    source: {
      bindingId,
      helperAddress: sourceHelper,
      helperVersion: "WalletHelperV1",
      runtimeCodeHash: sourceRuntime,
    },
    target: {
      abiHash: registry.target.abiHash,
      adapter: P05_HELPER_DEPLOYMENT_REGISTRY.components.find(({ role }) => role === "adapter")!
        .address,
      constructorArgumentsHash: material.constructorArgumentsHash,
      creationCodeHash: registry.target.creationCodeHash,
      expectedAddress: getContractAddress({
        from: owner,
        nonce: 7n,
      }).toLowerCase() as `0x${string}`,
      expectedRuntimeCodeHash: expectedRuntime,
      helperVersion: "WalletHelperV2",
      owner,
      permit2: P05_HELPER_DEPLOYMENT_REGISTRY.components.find(({ role }) => role === "permit2")!
        .address,
      selectorSetHash: localHelperUpgradeSelectorSetHash(registry.target.selectors),
      tokenA: {
        address: P05_HELPER_DEPLOYMENT_REGISTRY.tokens[0].address,
        runtimeCodeHash: P05_HELPER_DEPLOYMENT_REGISTRY.tokens[0].runtimeCodeHash,
      },
      tokenB: {
        address: P05_HELPER_DEPLOYMENT_REGISTRY.tokens[1].address,
        runtimeCodeHash: P05_HELPER_DEPLOYMENT_REGISTRY.tokens[1].runtimeCodeHash,
      },
    },
    transaction: {
      data: material.initCode,
      dataHash: material.initCodeHash,
      to: null,
      valueBaseUnit: "0",
    },
    wallet: { address: owner, walletId },
  };
  value.planDigest = localHelperUpgradePlanDigest(value);
  return value;
}

async function isolatedFixture() {
  const kms = new LocalKmsFixture({
    activeVersion: "local-v1",
    keys: { "local-v1": Buffer.alloc(32, 0x42) },
  });
  const signer = new IsolatedWalletSigner({ kms });
  const sealed = await signer.importAndSeal({
    envelopeVersion: 1,
    ingress: Buffer.from(
      JSON.stringify({ mode: "server-kek", name: "Helper V2 signer", privateKey }),
      "utf8",
    ),
    tenantId,
    userId,
    walletId,
  });
  const wallet: StoredCustodyWallet = {
    address: sealed.address,
    addressLower: sealed.addressLower,
    createdAt: now,
    envelopeVersion: 1,
    lockStatus: "ready",
    mode: "server-kek",
    name: sealed.name,
    revision: 1,
    tenantId,
    updatedAt: now,
    userId,
    walletId,
  };
  return { sealed, signer, wallet };
}

function databaseRow(value: LocalHelperUpgradePlan, generation = 0) {
  const replacement = generation > 0;
  return {
    active_generation: replacement ? 0 : null,
    active_max_fee: replacement ? "2" : null,
    active_max_priority: replacement ? "1" : null,
    active_state: replacement ? "pending" : null,
    active_transaction_id: replacement ? "9e090000-0000-4000-8000-000000000005" : null,
    ledger_fencing_token: value.fencingToken,
    ledger_next_nonce: "8",
    ledger_reconciliation_reason: null,
    operation_cursor: "deploy-v2",
    operation_plan_digest: value.planDigest,
    operation_plan_payload: structuredClone(value),
    operation_state: "running",
    replacement_expires_at: replacement ? new Date(now.getTime() + 60_000) : null,
    replacement_generation: replacement ? generation : null,
    replacement_init_code_hash: replacement ? value.transaction.dataHash : null,
    replacement_max_fee: replacement ? "3" : null,
    replacement_max_priority: replacement ? "2" : null,
    replacement_nonce: replacement ? value.nonce : null,
    replacement_owner: replacement ? value.target.owner : null,
    replacement_plan_digest: replacement ? value.planDigest : null,
    replacement_state: replacement ? "pending" : null,
    replacement_target_address: replacement ? value.target.expectedAddress : null,
    replacement_target_version: replacement ? value.target.helperVersion : null,
    source_adapter: value.target.adapter,
    source_helper: value.source.helperAddress,
    source_owner: value.wallet.address,
    source_permit2: value.target.permit2,
    source_registry: P05_LOCAL_HELPER_UPGRADE_REGISTRY.source.bindingRegistryVersion,
    source_runtime: value.source.runtimeCodeHash,
    source_state: "active",
    target_helper: value.target.expectedAddress,
    target_runtime: value.target.expectedRuntimeCodeHash,
    target_state: "deploying",
    transaction_count: replacement ? "1" : "0",
    wallet_address: value.wallet.address,
    wallet_lifecycle_status: "active",
    wallet_lock_status: "ready",
  };
}

function chainVerification(
  value: LocalHelperUpgradePlan,
  overrides: Partial<LocalHelperUpgradePlanChainVerification> = {},
): LocalHelperUpgradePlanChainVerification {
  return {
    canonicalSnapshotBlockHash: value.snapshot.blockHash,
    componentCodeMatches: true,
    expectedTargetCode: "0x",
    headBlockNumber: value.snapshot.blockNumber,
    latestNonce: value.nonce,
    pendingNonce: value.nonce,
    simulatedRuntimeCodeHash: value.target.expectedRuntimeCodeHash,
    source: {
      adapter: value.target.adapter,
      owner: value.wallet.address,
      permit2: value.target.permit2,
      runtimeCodeHash: value.source.runtimeCodeHash,
    },
    tokenCodeMatches: true,
    ...overrides,
  };
}

function authorizer(input: {
  chain?: Partial<LocalHelperUpgradePlanChainVerification>;
  generation?: number;
  value: LocalHelperUpgradePlan;
}) {
  const generation = input.generation ?? 0;
  const pool = {
    query: vi.fn(async () => ({ rows: [databaseRow(input.value, generation)] })),
  } as unknown as Pool;
  return new PostgresLocalHelperUpgradePlanAuthorizer(
    pool,
    {
      async verify(value) {
        return chainVerification(value, input.chain);
      },
    },
    { now: () => now },
  );
}

function authorization(value: LocalHelperUpgradePlan, generation = 0) {
  return {
    generation,
    maxFeePerGasBaseUnit: generation === 0 ? "2" : "3",
    maxPriorityFeePerGasBaseUnit: generation === 0 ? "1" : "2",
    operationId,
    plan: value,
    planDigest: value.planDigest,
    tenantId,
    userId,
  };
}

async function start(service: Partial<CustodySignerService>): Promise<string> {
  const server = createSignerHttpServer({ apiToken, service: service as CustodySignerService });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("signer fixture did not bind");
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  for (const server of servers) server.closeAllConnections();
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

describe("P05-09 isolated WalletHelperV2 deployment signer", () => {
  it("signs a plan-bound CREATE transaction and preserves generation, nonce, owner, and init code", async () => {
    const { sealed, signer, wallet } = await isolatedFixture();
    const value = plan();
    let raw: Buffer | null = null;
    const signed = await signer.signAndDeliverLocalHelperUpgrade({
      delivery: {
        async deliver({ rawTransaction }) {
          raw = Buffer.from(rawTransaction);
          return { deliveryId: "helper-upgrade-signer-delivery", status: "accepted" };
        },
      },
      envelope: sealed.envelope,
      generation: 0,
      maxFeePerGasBaseUnit: "2",
      maxPriorityFeePerGasBaseUnit: "1",
      now,
      operationId,
      plan: value,
      planDigest: value.planDigest,
      wallet,
    });

    expect(signed).toMatchObject({ generation: 0, operationId, planDigest: value.planDigest });
    const transaction = parseTransaction(toHex(raw!));
    expect(transaction).toMatchObject({
      chainId: 31_337,
      data: value.transaction.data,
      gas: 1000000n,
      maxFeePerGas: 2n,
      maxPriorityFeePerGas: 1n,
      nonce: 7,
      type: "eip1559",
    });
    expect(transaction.to).toBeUndefined();
    expect(transaction.value ?? 0n).toBe(0n);
  });

  it("rejects init code, nonce, owner, target, version, and plan digest tampering before delivery", async () => {
    const { sealed, signer, wallet } = await isolatedFixture();
    const deliver = vi.fn();
    const cases: Array<{
      mutate(value: LocalHelperUpgradePlan): void;
      outerDigest?: `sha256:${string}`;
    }> = [
      {
        mutate(value) {
          value.transaction.data = "0x00";
          value.transaction.dataHash = keccak256(value.transaction.data);
        },
      },
      { mutate: (value) => (value.nonce = "8") },
      { mutate: (value) => (value.target.owner = `0x${"66".repeat(20)}`) },
      { mutate: (value) => (value.target.expectedAddress = `0x${"77".repeat(20)}`) },
      {
        mutate(value) {
          (value.target as { helperVersion: string }).helperVersion = "WalletHelperV1";
        },
      },
      { mutate: () => undefined, outerDigest: `sha256:${"99".repeat(32)}` },
    ];

    for (const testCase of cases) {
      const value = plan();
      testCase.mutate(value);
      if (!testCase.outerDigest) value.planDigest = localHelperUpgradePlanDigest(value);
      await expect(
        signer.signAndDeliverLocalHelperUpgrade({
          delivery: { deliver },
          envelope: sealed.envelope,
          generation: 0,
          maxFeePerGasBaseUnit: "2",
          maxPriorityFeePerGasBaseUnit: "1",
          now,
          operationId,
          plan: value,
          planDigest: testCase.outerDigest ?? value.planDigest,
          wallet,
        }),
      ).rejects.toMatchObject({ code: "LOCAL_HELPER_UPGRADE_PLAN_REJECTED" });
    }
    expect(deliver).not.toHaveBeenCalled();
  });
});

describe("P05-09 WalletHelperV2 plan authorizer", () => {
  it("allows deterministic generation-zero recovery after the original broadcast advanced pending nonce", async () => {
    const value = plan();
    await expect(
      authorizer({ chain: { pendingNonce: "8" }, value }).authorize(authorization(value)),
    ).resolves.toBe(true);
  });

  it("allows persistence recovery after deployment confirmed only when the target runtime matches", async () => {
    const value = plan();
    await expect(
      authorizer({
        chain: {
          expectedTargetCode: deployedRuntime,
          latestNonce: "8",
          pendingNonce: "8",
        },
        value,
      }).authorize(authorization(value)),
    ).resolves.toBe(true);
    await expect(
      authorizer({
        chain: {
          expectedTargetCode: "0x6001",
          latestNonce: "8",
          pendingNonce: "8",
        },
        value,
      }).authorize(authorization(value)),
    ).resolves.toBe(false);
  });

  it("accepts only a monotonic fee replacement with every deployment identity field unchanged", async () => {
    const value = plan();
    await expect(
      authorizer({ chain: { pendingNonce: "8" }, generation: 1, value }).authorize(
        authorization(value, 1),
      ),
    ).resolves.toBe(true);

    for (const mutate of [
      (row: ReturnType<typeof databaseRow>) =>
        (row.replacement_init_code_hash = `0x${"11".repeat(32)}`),
      (row: ReturnType<typeof databaseRow>) => (row.replacement_nonce = "8"),
      (row: ReturnType<typeof databaseRow>) => (row.replacement_owner = `0x${"22".repeat(20)}`),
      (row: ReturnType<typeof databaseRow>) =>
        (row.replacement_target_address = `0x${"33".repeat(20)}`),
      (row: ReturnType<typeof databaseRow>) =>
        (row.replacement_plan_digest = `sha256:${"44".repeat(32)}`),
    ]) {
      const row = databaseRow(value, 1);
      mutate(row);
      const pool = { query: vi.fn(async () => ({ rows: [row] })) } as unknown as Pool;
      const rejected = new PostgresLocalHelperUpgradePlanAuthorizer(
        pool,
        {
          async verify() {
            return chainVerification(value, { pendingNonce: "8" });
          },
        },
        { now: () => now },
      );
      await expect(rejected.authorize(authorization(value, 1))).resolves.toBe(false);
    }
  });
});

describe("P05-09 WalletHelperV2 signer HTTP boundary", () => {
  it("round-trips only the typed deploy-new envelope through the loopback gateway", async () => {
    const value = plan();
    value.deadline = new Date(Date.now() + 10 * 60_000).toISOString();
    value.planDigest = localHelperUpgradePlanDigest(value);
    const signLocalHelperUpgrade = vi.fn(
      async (input: Parameters<CustodySignerService["signLocalHelperUpgrade"]>[0]) => {
        expect(input).toEqual({
          ...authorization(value),
          reauthenticatedSessionId: sessionId,
        });
        return {
          deliveryId: "local-helper-upgrade:http",
          generation: 0,
          operationId,
          planDigest: value.planDigest,
          status: "accepted" as const,
          transactionHash: `0x${"55".repeat(32)}` as const,
        };
      },
    );
    const url = await start({ signLocalHelperUpgrade });
    const gateway = new LoopbackLocalHelperUpgradeSignerGateway({ apiToken, url });

    await expect(
      gateway.signAndDeliver({
        ...authorization(value),
        reauthenticatedSessionId: sessionId,
      }),
    ).resolves.toMatchObject({ generation: 0, operationId, planDigest: value.planDigest });
    expect(signLocalHelperUpgrade).toHaveBeenCalledOnce();
  });
});
