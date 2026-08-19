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
import {
  IsolatedWalletSigner,
  LocalKmsFixture,
  type StoredCustodyWallet,
} from "../apps/signer/src/index.js";
import { getContractAddress, parseTransaction, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";

const privateKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const account = privateKeyToAccount(privateKey);
const owner = account.address.toLowerCase() as `0x${string}`;
const walletId = "9f000000-0000-4000-8000-000000000011";
const operationId = "9f000000-0000-4000-8000-000000000021";
const now = new Date("2026-08-20T00:00:00.000Z");

function plan(): HelperDeploymentPlan {
  const registry = P05_HELPER_DEPLOYMENT_REGISTRY;
  const material = buildWalletHelperV1DeploymentMaterial(owner);
  const value: HelperDeploymentPlan = {
    chainId: 31_337,
    deadline: new Date(now.getTime() + 10 * 60 * 1_000).toISOString(),
    deployment: {
      adapter: helperDeploymentComponent("adapter").address,
      constructorArgumentsHash: material.constructorArgumentsHash,
      creationCodeHash: registry.helperTemplate.creationCodeHash,
      expectedAddress: getContractAddress({
        from: owner,
        nonce: 0n,
      }).toLowerCase() as `0x${string}`,
      expectedRuntimeCodeHash: `0x${"91".repeat(32)}`,
      helperVersion: "WalletHelperV1",
      owner,
      permit2: helperDeploymentComponent("permit2").address,
      tokenA: {
        address: registry.tokens[0].address,
        runtimeCodeHash: registry.tokens[0].runtimeCodeHash,
      },
      tokenB: {
        address: registry.tokens[1].address,
        runtimeCodeHash: registry.tokens[1].runtimeCodeHash,
      },
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

async function fixture() {
  const kms = new LocalKmsFixture({
    activeVersion: "local-v1",
    keys: { "local-v1": Buffer.alloc(32, 0x42) },
  });
  const signer = new IsolatedWalletSigner({ kms });
  const ingress = Buffer.from(
    JSON.stringify({ mode: "server-kek", name: "Helper signer", privateKey }),
    "utf8",
  );
  const sealed = await signer.importAndSeal({
    envelopeVersion: 1,
    ingress,
    tenantId: "tenant-fixture-01",
    userId: "9f000000-0000-4000-8000-000000000001",
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
    tenantId: "tenant-fixture-01",
    updatedAt: now,
    userId: "9f000000-0000-4000-8000-000000000001",
    walletId,
  };
  return { sealed, signer, wallet };
}

describe("P05-05 isolated Helper deployment signer", () => {
  it("signs a zero-value CREATE transaction without a client-controlled target", async () => {
    const { sealed, signer, wallet } = await fixture();
    const deploymentPlan = plan();
    let raw: Buffer | null = null;
    const result = await signer.signAndDeliverHelperDeployment({
      delivery: {
        deliver: async ({ rawTransaction }) => {
          raw = Buffer.from(rawTransaction);
          return { deliveryId: "helper-local:fixture", status: "accepted" as const };
        },
      },
      envelope: sealed.envelope,
      now,
      plan: deploymentPlan,
      planDigest: deploymentPlan.planDigest,
      wallet,
    });
    expect(result.planDigest).toBe(deploymentPlan.planDigest);
    const transaction = parseTransaction(toHex(raw!));
    expect(transaction).toMatchObject({
      chainId: 31_337,
      data: deploymentPlan.transaction.data,
      nonce: 0,
      type: "eip1559",
    });
    expect(transaction).not.toHaveProperty("to");
    expect(transaction.value ?? 0n).toBe(0n);
  });

  it("rejects any target or constructor mutation before private-key use", async () => {
    const { sealed, signer, wallet } = await fixture();
    const targeted = structuredClone(plan()) as unknown as Omit<
      HelperDeploymentPlan,
      "transaction"
    > & {
      transaction: Omit<HelperDeploymentPlan["transaction"], "to"> & {
        to: `0x${string}` | null;
      };
    };
    targeted.transaction.to = `0x${"11".repeat(20)}`;
    targeted.planDigest = helperDeploymentPlanDigest(targeted as HelperDeploymentPlan);
    await expect(
      signer.signAndDeliverHelperDeployment({
        delivery: { deliver: async () => ({ deliveryId: "never:called", status: "accepted" }) },
        envelope: sealed.envelope,
        now,
        plan: targeted as HelperDeploymentPlan,
        planDigest: targeted.planDigest,
        wallet,
      }),
    ).rejects.toMatchObject({ code: "HELPER_PLAN_REJECTED" });
  });
});
