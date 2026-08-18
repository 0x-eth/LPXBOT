import {
  walletTransferPlanDigest,
  type WalletTransferPlan,
} from "../packages/domain/src/wallet-transfer.js";
import { LoopbackWalletTransferSignerGateway } from "../apps/worker/src/loopback-wallet-transfer-signer-gateway.js";
import { WalletTransferWorkerError } from "../apps/worker/src/wallet-transfer-worker.js";
import { describe, expect, it, vi } from "vitest";

const userId = "5c000000-0000-4000-8000-000000000001";
const walletId = "5c000000-0000-4000-8000-000000000011";
const sessionId = "5c000000-0000-4000-8000-000000000021";
const transactionHash = `0x${"ab".repeat(32)}` as const;
const apiToken = "synthetic-loopback-signer-token-at-least-32-bytes";

function plan(): WalletTransferPlan {
  const recipient = "0x2222222222222222222222222222222222222222" as const;
  return {
    amountBaseUnit: "1000",
    asset: { kind: "native" },
    chainId: 31_337,
    deadline: new Date(Date.now() + 60_000).toISOString(),
    feeLimit: {
      feeCapBaseUnit: "42000",
      gasLimit: "21000",
      maxFeePerGasBaseUnit: "2",
      maxPriorityFeePerGasBaseUnit: "1",
    },
    fencingToken: "1",
    nonce: "7",
    operationId: "5c000000-0000-4000-8000-000000000031",
    policyDigest: `sha256:${"cd".repeat(32)}`,
    recipient,
    transactionData: "0x",
    transactionTarget: recipient,
    transactionValueBaseUnit: "1000",
    walletAddress: "0x1111111111111111111111111111111111111111",
    walletId,
  };
}

function response(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

describe("P04-06 loopback wallet transfer signer gateway", () => {
  it("sends only an immutable plan with owner and unlock-session headers", async () => {
    const transferPlan = plan();
    const planDigest = walletTransferPlanDigest(transferPlan);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response(
        {
          data: {
            deliveryId: "anvil-local:abababababababab",
            planDigest,
            status: "accepted",
            transactionHash,
          },
          success: true,
        },
        202,
      ),
    );
    const gateway = new LoopbackWalletTransferSignerGateway({
      apiToken,
      fetch: fetcher,
      url: "http://127.0.0.1:43210",
    });

    await expect(
      gateway.signAndDeliver({
        plan: transferPlan,
        planDigest,
        reauthenticatedSessionId: sessionId,
        tenantId: "tenant-fixture-01",
        userId,
      }),
    ).resolves.toEqual({
      deliveryId: "anvil-local:abababababababab",
      planDigest,
      status: "accepted",
      transactionHash,
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe("http://127.0.0.1:43210/v1/wallet-transfers/sign-and-deliver");
    expect(init).toMatchObject({ method: "POST", redirect: "error" });
    expect(init?.headers).toMatchObject({
      Authorization: `Bearer ${apiToken}`,
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
      "X-LPBOT-Reauthenticated-Session-Id": sessionId,
      "X-LPBOT-Tenant-Id": "tenant-fixture-01",
      "X-LPBOT-User-Id": userId,
    });
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body).toEqual({ plan: transferPlan, planDigest });
    expect(body).not.toHaveProperty("rawTransaction");
    expect(body).not.toHaveProperty("password");
  });

  it("rejects public signer URLs and invalid plan digests before any request", async () => {
    for (const url of [
      "https://127.0.0.1:43210",
      "http://signer.example:43210",
      "http://127.0.0.1:43210/path",
      "http://user:pass@127.0.0.1:43210",
    ]) {
      expect(() => new LoopbackWalletTransferSignerGateway({ apiToken, url }), url).toThrowError(
        RangeError,
      );
    }

    const fetcher = vi.fn<typeof fetch>();
    const gateway = new LoopbackWalletTransferSignerGateway({
      apiToken,
      fetch: fetcher,
      url: "http://[::1]:43210",
    });
    await expect(
      gateway.signAndDeliver({
        plan: plan(),
        planDigest: `sha256:${"00".repeat(32)}`,
        tenantId: "tenant-fixture-01",
        userId,
      }),
    ).rejects.toMatchObject({ code: "TRANSFER_PLAN_INVALID", retryable: false });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("strictly rejects raw or mismatched signer responses", async () => {
    const transferPlan = plan();
    const planDigest = walletTransferPlanDigest(transferPlan);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response({
        data: {
          deliveryId: "anvil-local:abababababababab",
          planDigest,
          rawTransaction: "0x01",
          status: "accepted",
          transactionHash,
        },
        success: true,
      }),
    );
    const gateway = new LoopbackWalletTransferSignerGateway({
      apiToken,
      fetch: fetcher,
      url: "http://localhost:43210",
    });

    await expect(
      gateway.signAndDeliver({
        plan: transferPlan,
        planDigest,
        tenantId: "tenant-fixture-01",
        userId,
      }),
    ).rejects.toMatchObject({ code: "SIGNER_RESPONSE_INVALID", retryable: true });
  });

  it("preserves allowlisted signer errors and never retries", async () => {
    const transferPlan = plan();
    const planDigest = walletTransferPlanDigest(transferPlan);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response(
        {
          error: { code: "TRANSFER_DELIVERY_UNAVAILABLE", retryable: true },
          success: false,
        },
        503,
      ),
    );
    const gateway = new LoopbackWalletTransferSignerGateway({
      apiToken,
      fetch: fetcher,
      url: "http://127.0.0.1:43210",
    });

    await expect(
      gateway.signAndDeliver({
        plan: transferPlan,
        planDigest,
        tenantId: "tenant-fixture-01",
        userId,
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<WalletTransferWorkerError>>({
        code: "TRANSFER_DELIVERY_UNAVAILABLE",
        retryable: true,
      }),
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
