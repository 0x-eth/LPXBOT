import type { Server } from "node:http";

import type { CustodySignerService } from "../apps/signer/src/custody-signer-service.js";
import { createSignerHttpServer } from "../apps/signer/src/http-server.js";
import { LoopbackHelperDeploymentSignerGateway } from "../apps/worker/src/index.js";
import {
  buildWalletHelperV1DeploymentMaterial,
  helperDeploymentComponent,
  P05_HELPER_DEPLOYMENT_REGISTRY,
} from "../packages/chain-registry/src/index.js";
import {
  HELPER_DEPLOYMENT_PLAN_VERSION,
  helperDeploymentPlanDigest,
  type HelperDeploymentPlan,
} from "../packages/domain/src/helper-deployment.js";
import { getContractAddress } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";

const apiToken = "helper-signer-api-token-fixture-at-least-32-bytes";
const tenantId = "tenant-fixture-01";
const userId = "9e000000-0000-4000-8000-000000000001";
const walletId = "9e000000-0000-4000-8000-000000000011";
const sessionId = "9e000000-0000-4000-8000-000000000021";
const operationId = "9e000000-0000-4000-8000-000000000031";
const owner = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266" as const;
const servers: Server[] = [];

function plan(): HelperDeploymentPlan {
  const registry = P05_HELPER_DEPLOYMENT_REGISTRY;
  const material = buildWalletHelperV1DeploymentMaterial(owner);
  const value: HelperDeploymentPlan = {
    chainId: 31_337,
    deadline: new Date(Date.now() + 10 * 60 * 1_000).toISOString(),
    deployment: {
      adapter: helperDeploymentComponent("adapter").address,
      constructorArgumentsHash: material.constructorArgumentsHash,
      creationCodeHash: registry.helperTemplate.creationCodeHash,
      expectedAddress: getContractAddress({ from: owner, nonce: 0n }).toLowerCase() as `0x${string}`,
      expectedRuntimeCodeHash: `0x${"91".repeat(32)}`,
      helperVersion: "WalletHelperV1",
      owner,
      permit2: helperDeploymentComponent("permit2").address,
      tokenA: registry.tokens[0],
      tokenB: registry.tokens[1],
    },
    feeLimit: {
      feeCapBaseUnit: "2400000",
      gasLimit: "1200000",
      maxFeePerGasBaseUnit: "2",
      maxPriorityFeePerGasBaseUnit: "1",
    },
    fencingToken: "1",
    nonce: "0",
    operationId,
    planDigest: `sha256:${"0".repeat(64)}`,
    planVersion: HELPER_DEPLOYMENT_PLAN_VERSION,
    registry: {
      blockNumber: "1",
      digest: registry.registryDigest,
      rollbackVersion: registry.rollbackVersion,
      version: registry.registryVersion,
    },
    schemaVersion: 2,
    snapshotDigest: `sha256:${"a".repeat(64)}`,
    transaction: {
      data: material.initCode,
      dataHash: material.initCodeHash,
      to: null,
      valueBaseUnit: "0",
    },
    wallet: { address: owner, walletId },
  };
  value.planDigest = helperDeploymentPlanDigest(value);
  return value;
}

async function start(service: Partial<CustodySignerService>): Promise<string> {
  const server = createSignerHttpServer({
    apiToken,
    service: service as CustodySignerService,
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("signer fixture did not bind");
  return `http://127.0.0.1:${address.port}`;
}

function helperRequest(url: string, body: unknown): Promise<Response> {
  return fetch(`${url}/v1/helper-deployments/sign-and-deliver`, {
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

function successResponse(planDigest: `sha256:${string}`, extra: object = {}): Response {
  return new Response(
    JSON.stringify({
      data: {
        deliveryId: "helper-local:fixture",
        planDigest,
        status: "accepted",
        transactionHash: `0x${"42".repeat(32)}`,
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

describe("P05-05 Helper deployment signer HTTP boundary", () => {
  it("accepts only the exact plan envelope and forwards ownership context", async () => {
    const deploymentPlan = plan();
    const signHelperDeployment = vi.fn(
      async (input: Parameters<CustodySignerService["signHelperDeployment"]>[0]) => {
        expect(input).toMatchObject({
          plan: deploymentPlan,
          planDigest: deploymentPlan.planDigest,
          reauthenticatedSessionId: sessionId,
          tenantId,
          userId,
        });
        return {
          deliveryId: "helper-local:http",
          planDigest: deploymentPlan.planDigest,
          status: "accepted" as const,
          transactionHash: `0x${"43".repeat(32)}` as const,
        };
      },
    );
    const url = await start({ signHelperDeployment });
    const response = await helperRequest(url, {
      plan: deploymentPlan,
      planDigest: deploymentPlan.planDigest,
    });
    expect(response.status).toBe(202);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      data: { planDigest: deploymentPlan.planDigest, status: "accepted" },
      success: true,
    });
    expect(signHelperDeployment).toHaveBeenCalledOnce();
  });

  it("rejects target, calldata, wrong-chain, and outer-field injection before service use", async () => {
    const signHelperDeployment = vi.fn();
    const url = await start({ signHelperDeployment });
    const deploymentPlan = plan();
    const targeted = structuredClone(deploymentPlan) as unknown as {
      transaction: Record<string, unknown>;
    };
    targeted.transaction.to = `0x${"11".repeat(20)}`;
    const calldata = structuredClone(deploymentPlan) as unknown as {
      transaction: Record<string, unknown>;
    };
    calldata.transaction.calldata = "0xdeadbeef";
    const wrongChain = structuredClone(deploymentPlan) as unknown as Record<string, unknown>;
    wrongChain.chainId = 56;
    const bodies = [
      { plan: targeted, planDigest: deploymentPlan.planDigest },
      { plan: calldata, planDigest: deploymentPlan.planDigest },
      { plan: wrongChain, planDigest: deploymentPlan.planDigest },
      { plan: deploymentPlan, planDigest: deploymentPlan.planDigest, target: owner },
    ];
    for (const body of bodies) {
      const response = await helperRequest(url, body);
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({
        error: { code: "HELPER_PLAN_REJECTED", retryable: false },
        success: false,
      });
    }
    expect(signHelperDeployment).not.toHaveBeenCalled();
  });
});

describe("P05-05 loopback Helper signer gateway", () => {
  it("pins loopback transport and accepts only the strict 202 response contract", async () => {
    const deploymentPlan = plan();
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      expect(init).toMatchObject({ method: "POST", redirect: "error" });
      expect(init?.headers).toMatchObject({
        Authorization: `Bearer ${apiToken}`,
        "Cache-Control": "no-store",
        "Content-Type": "application/json",
        "X-LPBOT-Reauthenticated-Session-Id": sessionId,
        "X-LPBOT-Tenant-Id": tenantId,
        "X-LPBOT-User-Id": userId,
      });
      expect(JSON.parse(String(init?.body))).toEqual({
        plan: deploymentPlan,
        planDigest: deploymentPlan.planDigest,
      });
      return successResponse(deploymentPlan.planDigest);
    });
    const gateway = new LoopbackHelperDeploymentSignerGateway({
      apiToken,
      fetch: fetcher,
      url: "http://127.0.0.1:4100",
    });
    await expect(
      gateway.signAndDeliver({
        plan: deploymentPlan,
        planDigest: deploymentPlan.planDigest,
        reauthenticatedSessionId: sessionId,
        tenantId,
        userId,
      }),
    ).resolves.toEqual({
      deliveryId: "helper-local:fixture",
      planDigest: deploymentPlan.planDigest,
      status: "accepted",
      transactionHash: `0x${"42".repeat(32)}`,
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("rejects injected plans and malformed success envelopes without retrying transport", async () => {
    const deploymentPlan = plan();
    const targeted = structuredClone(deploymentPlan) as unknown as HelperDeploymentPlan & {
      transaction: { to: `0x${string}` | null };
    };
    (targeted.transaction as unknown as Record<string, unknown>).to = owner;
    targeted.planDigest = helperDeploymentPlanDigest(targeted);
    const unusedFetch = vi.fn<typeof fetch>();
    const rejectingGateway = new LoopbackHelperDeploymentSignerGateway({
      apiToken,
      fetch: unusedFetch,
      url: "http://localhost:4100",
    });
    await expect(
      rejectingGateway.signAndDeliver({
        plan: targeted,
        planDigest: targeted.planDigest,
        tenantId,
        userId,
      }),
    ).rejects.toMatchObject({ code: "HELPER_PLAN_INVALID", retryable: false });
    expect(unusedFetch).not.toHaveBeenCalled();

    for (const response of [
      successResponse(deploymentPlan.planDigest, { target: owner }),
      new Response(JSON.stringify({ data: {}, success: true }), {
        headers: { "Cache-Control": "no-store", "Content-Type": "application/json" },
        status: 202,
      }),
      new Response(JSON.stringify({ data: {}, success: true }), {
        headers: { "Cache-Control": "no-store", "Content-Type": "application/json" },
        status: 200,
      }),
    ]) {
      const gateway = new LoopbackHelperDeploymentSignerGateway({
        apiToken,
        fetch: async () => response,
        url: "http://127.0.0.1:4100",
      });
      await expect(
        gateway.signAndDeliver({
          plan: deploymentPlan,
          planDigest: deploymentPlan.planDigest,
          tenantId,
          userId,
        }),
      ).rejects.toMatchObject({ code: "HELPER_SIGNER_RESPONSE_INVALID", retryable: true });
    }
    expect(
      () =>
        new LoopbackHelperDeploymentSignerGateway({
          apiToken,
          fetch: unusedFetch,
          url: "https://signer.example.invalid",
        }),
    ).toThrow("Helper deployment signer URL is invalid");
  });
});
