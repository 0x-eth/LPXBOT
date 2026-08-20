import type { Server } from "node:http";

import type { CustodySignerService } from "../apps/signer/src/custody-signer-service.js";
import { createSignerHttpServer } from "../apps/signer/src/http-server.js";
import {
  IsolatedWalletSigner,
  LocalKmsFixture,
  type StoredCustodyWallet,
} from "../apps/signer/src/index.js";
import { LoopbackLocalHelperSweepSignerGateway } from "../apps/worker/src/index.js";
import { P05_LOCAL_HELPER_SWEEP_REGISTRY } from "../packages/chain-registry/src/index.js";
import {
  localHelperSweepCalldata,
  localHelperSweepDataDigest,
  localHelperSweepPlanDigest,
  localHelperSweepSemanticDigest,
  type LocalHelperSweepPlan,
} from "../packages/domain/src/local-helper-sweep.js";
import { parseTransaction, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterEach, describe, expect, it, vi } from "vitest";

const privateKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const owner = privateKeyToAccount(privateKey).address.toLowerCase() as `0x${string}`;
const apiToken = "local-helper-sweep-signer-token-at-least-32-bytes";
const tenantId = "tenant-fixture-01";
const userId = "a8180000-0000-4000-8000-000000000001";
const walletId = "a8180000-0000-4000-8000-000000000011";
const sessionId = "a8180000-0000-4000-8000-000000000021";
const operationId = "a8180000-0000-4000-8000-000000000031";
const batchId = "a8180000-0000-4000-8000-000000000041";
const helperAddress = "0x1000000000000000000000000000000000000001" as const;
const now = new Date("2026-08-20T08:00:00.000Z");
const servers: Server[] = [];

function plan(): LocalHelperSweepPlan {
  const registry = P05_LOCAL_HELPER_SWEEP_REGISTRY;
  const token = registry.tokens[0]!;
  const value: LocalHelperSweepPlan = {
    asset: {
      amountBaseUnit: "10",
      assetId: `token:${token.address}`,
      dustBaseUnit: token.dustBaseUnit,
      fixture: token.fixture,
      kind: "token",
      tokenAddress: token.address,
    },
    batchId,
    chainId: 31_337,
    deadline: new Date(now.getTime() + 600_000).toISOString(),
    feeLimit: {
      feeCapBaseUnit: "400000",
      gasLimit: "100000",
      maxFeePerGasBaseUnit: "4",
      maxPriorityFeePerGasBaseUnit: "2",
    },
    fencingToken: "2",
    helper: {
      adapterAddress: registry.components.find(({ role }) => role === "adapter")!.address,
      bindingId: "a8180000-0000-4000-8000-000000000051",
      deploymentRegistryVersion: "p05-local-helper-deployment-v2",
      helperAddress,
      helperVersion: "WalletHelperV1",
      ownerAddress: owner,
      permit2Address: registry.components.find(({ role }) => role === "permit2")!.address,
      runtimeCodeHash: registry.helper.runtimeTemplateHash,
      verifiedBlockNumber: "8",
      walletId,
    },
    nonce: "0",
    operationId,
    planDigest: `sha256:${"00".repeat(32)}`,
    planVersion: registry.planVersion,
    recipient: owner,
    registry: {
      digest: registry.registryDigest,
      rollbackVersion: registry.rollbackVersion,
      version: registry.registryVersion,
    },
    schemaVersion: 2,
    semanticDigest: `sha256:${"00".repeat(32)}`,
    serviceFeeBps: 0,
    snapshot: {
      blockHash: `0x${"11".repeat(32)}`,
      blockNumber: "8",
      digest: `sha256:${"22".repeat(32)}`,
    },
    transaction: {
      data: "0x",
      dataDigest: `sha256:${"00".repeat(32)}`,
      selector: registry.helper.selectors.sweepToken,
      to: helperAddress,
      valueBaseUnit: "0",
    },
    wallet: { address: owner, walletId },
  };
  value.planDigest = localHelperSweepPlanDigest(value);
  value.transaction.data = localHelperSweepCalldata(value.planDigest, value.asset);
  value.transaction.dataDigest = localHelperSweepDataDigest(value.transaction.data);
  value.semanticDigest = localHelperSweepSemanticDigest(value);
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
      JSON.stringify({ mode: "server-kek", name: "Helper sweep signer", privateKey }),
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

async function start(service: Partial<CustodySignerService>): Promise<string> {
  const server = createSignerHttpServer({ apiToken, service: service as CustodySignerService });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("signer fixture did not bind");
  return `http://127.0.0.1:${address.port}`;
}

function signingRequest(url: string, body: unknown): Promise<Response> {
  return fetch(`${url}/v1/local-helper-sweeps/sign-and-deliver`, {
    body: JSON.stringify(body),
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
      "X-LPBOT-Reauthenticated-Session-Id": sessionId,
      "X-LPBOT-Tenant-Id": tenantId,
      "X-LPBOT-User-Id": userId,
    },
    method: "POST",
  });
}

function successResponse(value: LocalHelperSweepPlan, extra: object = {}): Response {
  return new Response(
    JSON.stringify({
      data: {
        deliveryId: "local-helper-sweep:fixture",
        generation: 0,
        operationId: value.operationId,
        planDigest: value.planDigest,
        status: "accepted",
        transactionHash: `0x${"33".repeat(32)}`,
        ...extra,
      },
      success: true,
    }),
    {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/json; charset=utf-8",
      },
      status: 202,
    },
  );
}

afterEach(async () => {
  for (const server of servers) server.closeAllConnections();
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

describe("P05-08 isolated local Helper sweep signer", () => {
  it("signs only the fixed zero-value Helper call with plan-bound nonce and fee", async () => {
    const { sealed, signer, wallet } = await isolatedFixture();
    const value = plan();
    let raw: Buffer | null = null;
    const signed = await signer.signAndDeliverLocalHelperSweep({
      delivery: {
        async deliver({ rawTransaction }) {
          raw = Buffer.from(rawTransaction);
          return { deliveryId: "local-helper-sweep:isolated", status: "accepted" };
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
      gas: 100000n,
      maxFeePerGas: 2n,
      maxPriorityFeePerGas: 1n,
      nonce: 0,
      to: helperAddress,
      type: "eip1559",
    });
    expect(transaction.value ?? 0n).toBe(0n);
  });

  it("rejects target, recipient, calldata, expired plan and fee-cap mutation before delivery", async () => {
    const { sealed, signer, wallet } = await isolatedFixture();
    const deliver = vi.fn();
    const mutations: Array<(value: LocalHelperSweepPlan) => void> = [
      (value) => (value.transaction.to = P05_LOCAL_HELPER_SWEEP_REGISTRY.tokens[1]!.address),
      (value) => (value.recipient = helperAddress),
      (value) => (value.transaction.data = "0x3609afa9"),
      (value) => (value.deadline = now.toISOString()),
    ];
    for (const mutate of mutations) {
      const value = plan();
      mutate(value);
      await expect(
        signer.signAndDeliverLocalHelperSweep({
          delivery: { deliver },
          envelope: sealed.envelope,
          generation: 0,
          maxFeePerGasBaseUnit: "2",
          maxPriorityFeePerGasBaseUnit: "1",
          now,
          operationId,
          plan: value,
          planDigest: value.planDigest,
          wallet,
        }),
      ).rejects.toMatchObject({
        code:
          value.deadline === now.toISOString()
            ? "LOCAL_HELPER_SWEEP_PLAN_EXPIRED"
            : "LOCAL_HELPER_SWEEP_PLAN_REJECTED",
      });
    }
    const value = plan();
    await expect(
      signer.signAndDeliverLocalHelperSweep({
        delivery: { deliver },
        envelope: sealed.envelope,
        generation: 0,
        maxFeePerGasBaseUnit: "5",
        maxPriorityFeePerGasBaseUnit: "1",
        now,
        operationId,
        plan: value,
        planDigest: value.planDigest,
        wallet,
      }),
    ).rejects.toMatchObject({ code: "LOCAL_HELPER_SWEEP_PLAN_REJECTED" });
    expect(deliver).not.toHaveBeenCalled();
  });
});

describe("P05-08 local Helper sweep signer HTTP boundary", () => {
  it("forwards the exact operation envelope and rejects arbitrary field injection", async () => {
    const value = plan();
    const signLocalHelperSweep = vi.fn(
      async (input: Parameters<CustodySignerService["signLocalHelperSweep"]>[0]) => {
        expect(input).toEqual({
          generation: 0,
          maxFeePerGasBaseUnit: "2",
          maxPriorityFeePerGasBaseUnit: "1",
          operationId,
          plan: value,
          planDigest: value.planDigest,
          reauthenticatedSessionId: sessionId,
          tenantId,
          userId,
        });
        return {
          deliveryId: "local-helper-sweep:http",
          generation: 0,
          operationId,
          planDigest: value.planDigest,
          status: "accepted" as const,
          transactionHash: `0x${"44".repeat(32)}` as const,
        };
      },
    );
    const url = await start({ signLocalHelperSweep });
    const body = {
      generation: 0,
      maxFeePerGasBaseUnit: "2",
      maxPriorityFeePerGasBaseUnit: "1",
      operationId,
      plan: value,
      planDigest: value.planDigest,
    };
    const response = await signingRequest(url, body);
    expect(response.status).toBe(202);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(signLocalHelperSweep).toHaveBeenCalledOnce();

    for (const injected of [
      { ...body, target: helperAddress },
      { ...body, token: value.asset.tokenAddress },
      { ...body, amount: value.asset.amountBaseUnit },
      { ...body, recipient: owner },
      { ...body, calldata: value.transaction.data },
      { ...body, fee: value.feeLimit },
      { ...body, plan: { ...value, target: helperAddress } },
      { ...body, plan: { ...value, asset: { ...value.asset, amount: "10" } } },
    ]) {
      const rejected = await signingRequest(url, injected);
      expect(rejected.status).toBe(409);
      await expect(rejected.json()).resolves.toEqual({
        error: { code: "LOCAL_HELPER_SWEEP_PLAN_REJECTED", retryable: false },
        success: false,
      });
    }
    expect(signLocalHelperSweep).toHaveBeenCalledOnce();
  });
});

describe("P05-08 loopback local Helper sweep signer gateway", () => {
  it("pins loopback transport and binds the strict response to one asset operation", async () => {
    const value = plan();
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      expect(url).toBe("http://127.0.0.1:4100/v1/local-helper-sweeps/sign-and-deliver");
      expect(init).toMatchObject({ method: "POST", redirect: "error" });
      expect(init?.headers).toMatchObject({
        Authorization: `Bearer ${apiToken}`,
        "X-LPBOT-Reauthenticated-Session-Id": sessionId,
        "X-LPBOT-Tenant-Id": tenantId,
        "X-LPBOT-User-Id": userId,
      });
      expect(JSON.parse(String(init?.body))).toEqual({
        generation: 0,
        maxFeePerGasBaseUnit: "2",
        maxPriorityFeePerGasBaseUnit: "1",
        operationId,
        plan: value,
        planDigest: value.planDigest,
      });
      return successResponse(value);
    });
    const gateway = new LoopbackLocalHelperSweepSignerGateway({
      endpoint: "http://127.0.0.1:4100/v1/local-helper-sweeps/sign-and-deliver",
      fetch: fetcher,
      token: apiToken,
    });
    await expect(
      gateway.signAndDeliver({
        generation: 0,
        maxFeePerGasBaseUnit: "2",
        maxPriorityFeePerGasBaseUnit: "1",
        operationId,
        plan: value,
        planDigest: value.planDigest,
        reauthenticatedSessionId: sessionId,
        tenantId,
        userId,
      }),
    ).resolves.toMatchObject({ generation: 0, operationId, planDigest: value.planDigest });
  });

  it("rejects public endpoints and mismatched or injected success envelopes", async () => {
    for (const endpoint of [
      "http://localhost:4100/v1/local-helper-sweeps/sign-and-deliver",
      "https://127.0.0.1:4100/v1/local-helper-sweeps/sign-and-deliver",
      "http://signer.example:4100/v1/local-helper-sweeps/sign-and-deliver",
    ]) {
      expect(
        () => new LoopbackLocalHelperSweepSignerGateway({ endpoint, token: apiToken }),
      ).toThrowError(RangeError);
    }
    const value = plan();
    for (const response of [
      successResponse(value, { target: helperAddress }),
      successResponse(value, { operationId: "a8180000-0000-4000-8000-000000000099" }),
      new Response(JSON.stringify({ data: {}, success: true }), {
        headers: { "Cache-Control": "no-store", "Content-Type": "application/json" },
        status: 202,
      }),
    ]) {
      const gateway = new LoopbackLocalHelperSweepSignerGateway({
        endpoint: "http://127.0.0.1:4100/v1/local-helper-sweeps/sign-and-deliver",
        fetch: async () => response,
        token: apiToken,
      });
      await expect(
        gateway.signAndDeliver({
          generation: 0,
          maxFeePerGasBaseUnit: "2",
          maxPriorityFeePerGasBaseUnit: "1",
          operationId,
          plan: value,
          planDigest: value.planDigest,
          tenantId,
          userId,
        }),
      ).rejects.toMatchObject({
        code: "LOCAL_HELPER_SWEEP_SIGNER_RESPONSE_INVALID",
        retryable: true,
      });
    }
  });
});
