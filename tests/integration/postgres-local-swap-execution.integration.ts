import { randomUUID } from "node:crypto";

import type { CustodyWallet } from "../../packages/api-contract/src/index.js";
import {
  LocalSwapQuoteAdapter,
  type LocalSwapQuoteProvider,
} from "../../packages/chain-adapters/src/index.js";
import {
  P05_HELPER_DEPLOYMENT_REGISTRY,
  P05_LOCAL_SWAP_EXECUTION_REGISTRY,
} from "../../packages/chain-registry/src/index.js";
import {
  ControlledLocalSwapQuoteService,
  HelperDeploymentService,
  LocalSwapExecutionService,
  PostgresHelperDeploymentOperationStore,
  PostgresHelperDeploymentPreviewStore,
  PostgresLocalSwapHelperBindingStore,
  PostgresLocalSwapOperationStore,
  PostgresLocalSwapPreviewStore,
  PostgresLocalSwapQuoteStore,
  type HelperDeploymentChainReader,
  type LocalSwapChainInspection,
} from "../../apps/api/src/index.js";
import { PostgresCustodyWalletStore } from "../../apps/signer/src/postgres-custody-wallet-store.js";
import {
  PostgresHelperDeploymentRecoveryRepository,
  PostgresLocalSwapRecoveryRepository,
  type HelperDeploymentWorkClaim,
  type LocalSwapReceiptObservation,
  type LocalSwapWorkClaim,
} from "../../apps/worker/src/index.js";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for PostgreSQL integration tests");

const pool = new Pool({ connectionString: databaseUrl, max: 12 });
const tenantId = "tenant-fixture-01";
const userId = randomUUID();
const sessionId = randomUUID();
const walletId = randomUUID();
const walletAddress = "0x1000000000000000000000000000000000000066" as const;
let clock = new Date();

class HelperChain implements HelperDeploymentChainReader {
  async nonceSnapshot() {
    return {
      blockHash: `0x${"71".repeat(32)}` as const,
      blockNumber: "7",
      blockTimestamp: clock.toISOString(),
      chainId: 31_337 as const,
      views: [
        { latest: "0", pending: "0", providerId: "anvil-a" },
        { latest: "0", pending: "0", providerId: "anvil-b" },
      ],
    };
  }

  async inspectDeployment() {
    return {
      componentCode: P05_HELPER_DEPLOYMENT_REGISTRY.components.map((component) => ({
        ...component,
      })),
      expectedAddressCode: "0x" as const,
      expectedRuntimeCodeHash: `0x${"91".repeat(32)}` as const,
      feeLimit: {
        feeCapBaseUnit: "2400000",
        gasLimit: "1200000",
        maxFeePerGasBaseUnit: "2",
        maxPriorityFeePerGasBaseUnit: "1",
      },
      tokenCode: P05_HELPER_DEPLOYMENT_REGISTRY.tokens.map(({ address, runtimeCodeHash }) => ({
        address,
        runtimeCodeHash,
      })),
    };
  }
}

async function createWallet(): Promise<CustodyWallet> {
  const store = new PostgresCustodyWalletStore(pool);
  return store.create({
    auditAction: "wallet.import",
    envelope: {
      aadVersion: 1,
      algorithm: "AES-256-GCM",
      ciphertext: Buffer.alloc(32, 1),
      createdAt: clock,
      envelopeVersion: 1,
      kekId: "local-fixture",
      kekVersion: "local-v1",
      nonce: Buffer.alloc(12, 2),
      tag: Buffer.alloc(16, 3),
      wrappedDek: Buffer.alloc(60, 4),
    },
    wallet: {
      address: walletAddress,
      addressLower: walletAddress,
      createdAt: clock,
      envelopeVersion: 1,
      lockStatus: "ready",
      mode: "server-kek",
      name: "Local Swap recovery fixture",
      revision: 1,
      tenantId,
      updatedAt: clock,
      userId,
      walletId,
    },
  });
}

async function activeHelper(wallet: CustodyWallet): Promise<void> {
  const operations = new PostgresHelperDeploymentOperationStore(pool, { now: () => clock });
  const service = new HelperDeploymentService({
    chain: new HelperChain(),
    now: () => clock,
    operations,
    previews: new PostgresHelperDeploymentPreviewStore(pool),
  });
  const request = {
    chainId: 31_337 as const,
    helperVersion: "WalletHelperV1" as const,
    walletId,
  };
  const preview = await service.preview({ request, tenantId, userId, wallet });
  const submitted = await service.submit({
    idempotencyKey: "local-swap-helper-binding-0001",
    request: {
      ...request,
      previewDigest: preview.previewDigest,
      previewToken: preview.previewToken,
    },
    requestId: "request-local-swap-helper",
    sessionId,
    tenantId,
    userId,
    wallet,
  });
  const repository = new PostgresHelperDeploymentRecoveryRepository(pool, {
    confirmedPollMilliseconds: 1_000,
    pollMilliseconds: 1_000,
  });
  const queued = await claimHelper(
    repository,
    submitted.operation.operationId,
    "helper-local-swap",
  );
  const transactionHash = `0x${"10".repeat(32)}` as const;
  await repository.completeBroadcast({
    claim: queued,
    deliveredAt: new Date(clock.getTime() + 1),
    result: {
      deliveryId: "local-swap-helper",
      planDigest: queued.operation.planDigest,
      status: "accepted",
      transactionHash,
    },
  });
  clock = new Date(clock.getTime() + 1_001);
  const broadcast = await claimHelper(
    repository,
    submitted.operation.operationId,
    "helper-local-swap",
  );
  const plan = broadcast.operation.plan;
  await repository.applyObservation({
    claim: broadcast,
    decision: {
      kind: "receipt",
      reason: null,
      receipt: {
        blockCanonical: true,
        blockHash: `0x${"72".repeat(32)}`,
        blockNumber: "8",
        confirmations: "2",
        constructorReconciled: true,
        contractAddress: plan.deployment.expectedAddress,
        contractAddressReconciled: true,
        observedAdapter: plan.deployment.adapter,
        observedOwner: plan.deployment.owner,
        observedPermit2: plan.deployment.permit2,
        ownerReconciled: true,
        receiptStatus: "success",
        runtimeCodeHash: plan.deployment.expectedRuntimeCodeHash,
        runtimeCodeReconciled: true,
        transactionHash,
      },
      state: "succeeded",
      transactionId: broadcast.operation.activeTransaction!.transactionId,
    },
    observedAt: clock,
  });
}

async function claimHelper(
  repository: PostgresHelperDeploymentRecoveryRepository,
  operationId: string,
  workerId: string,
): Promise<HelperDeploymentWorkClaim> {
  const claims = await repository.claimDue({
    leaseMilliseconds: 10_000,
    limit: 10,
    now: clock,
    workerId,
  });
  const claim = claims.find(({ operation }) => operation.operationId === operationId);
  if (!claim) throw new Error(`No Helper claim for ${operationId}`);
  return claim;
}

async function claimSwap(
  repository: PostgresLocalSwapRecoveryRepository,
  operationId: string,
): Promise<LocalSwapWorkClaim> {
  const claims = await repository.claimDue({
    leaseMilliseconds: 10_000,
    limit: 10,
    now: clock,
    workerId: "local-swap-worker",
  });
  const claim = claims.find(({ operation }) => operation.operationId === operationId);
  if (!claim) throw new Error(`No local Swap claim for ${operationId}`);
  return claim;
}

function receipt(
  claim: LocalSwapWorkClaim,
  input: {
    allowance: string;
    block: number;
    status?: "reverted" | "success";
    transactionHash?: `0x${string}`;
  },
): LocalSwapReceiptObservation {
  const swap = claim.operation.step.kind === "swap";
  return {
    adapterToRouterAllowance: swap ? "0" : null,
    blockCanonical: true,
    blockHash: `0x${input.block.toString(16).padStart(64, "0")}`,
    blockNumber: String(input.block),
    confirmations: "2",
    helperInputDust: swap ? "0" : null,
    helperOutputDust: swap ? "0" : null,
    helperToAdapterAllowance: swap ? "0" : null,
    minOutBaseUnit: swap ? claim.operation.plan.quote.minOutBaseUnit : null,
    ownerOutputAfter: swap ? "1000" : null,
    ownerOutputBefore: swap ? "1000" : null,
    ownerToSpenderAllowance: input.allowance,
    planExecutedEvent: swap ? input.status !== "reverted" : null,
    planReplayRecorded: swap ? input.status !== "reverted" : null,
    receiptStatus: input.status ?? "success",
    swapExecutedEvent: swap ? input.status !== "reverted" : null,
    transactionHash: input.transactionHash ?? claim.operation.activeTransaction!.transactionHash,
  };
}

beforeAll(async () => {
  await pool.query(
    `INSERT INTO users (id, role, tier, status, display_name, created_at, updated_at)
     VALUES ($1, 'user', 'normal', 'active', 'Local Swap recovery fixture', $2, $2)`,
    [userId, clock],
  );
});

afterAll(async () => {
  await pool.query("DELETE FROM users WHERE id = $1", [userId]);
  await pool.end();
});

describe("P05-06 PostgreSQL local Swap execution and recovery", () => {
  it("persists replacement lineage and keeps a reverted Swap reconciling until cleanup confirms", async () => {
    const wallet = await createWallet();
    await activeHelper(wallet);
    const bindings = new PostgresLocalSwapHelperBindingStore(pool);
    const binding = await bindings.getActive({ tenantId, userId, walletId });
    if (!binding) throw new Error("active Helper binding was not created");
    const quoteStore = new PostgresLocalSwapQuoteStore(pool);
    const quoteProvider: LocalSwapQuoteProvider = {
      async inspect() {
        return {
          amountOutBaseUnit: "1000",
          blockHash: `0x${"73".repeat(32)}`,
          blockNumber: "8",
          blockTimestamp: clock.toISOString(),
          componentCode: P05_LOCAL_SWAP_EXECUTION_REGISTRY.components.map((component) => ({
            ...component,
          })),
          gasLimit: "500000",
          helper: {
            adapter: binding.adapterAddress,
            codeHash: binding.runtimeCodeHash,
            owner: binding.ownerAddress,
            permit2: binding.permit2Address,
          },
          maxFeePerGasBaseUnit: "20",
          maxPriorityFeePerGasBaseUnit: "2",
          providerSnapshotId: randomUUID(),
          tokenCode: P05_LOCAL_SWAP_EXECUTION_REGISTRY.tokens.map(
            ({ address, runtimeCodeHash }) => ({ address, runtimeCodeHash }),
          ),
        };
      },
    };
    const quotes = new ControlledLocalSwapQuoteService({
      adapter: new LocalSwapQuoteAdapter({ now: () => clock, provider: quoteProvider }),
      bindings,
      store: quoteStore,
    });
    const quote = await quotes.quote({
      amountInBaseUnit: "1000",
      chainId: 31_337,
      slippageBps: 100,
      tenantId,
      tokenIn: P05_LOCAL_SWAP_EXECUTION_REGISTRY.tokens[0].address,
      tokenOut: P05_LOCAL_SWAP_EXECUTION_REGISTRY.tokens[1].address,
      userId,
      walletAddress,
      walletId,
    });
    const inspection: LocalSwapChainInspection = {
      allowanceBaseUnit: "0",
      blockHash: `0x${"74".repeat(32)}`,
      blockNumber: "9",
      blockTimestamp: clock.toISOString(),
      componentCode: P05_LOCAL_SWAP_EXECUTION_REGISTRY.components.map((component) => ({
        ...component,
      })),
      helper: {
        adapter: binding.adapterAddress,
        codeHash: binding.runtimeCodeHash,
        owner: binding.ownerAddress,
        permit2: binding.permit2Address,
      },
      nonceViews: [
        { latest: "1", pending: "1", providerId: "anvil-a" },
        { latest: "1", pending: "1", providerId: "anvil-b" },
      ],
      ownerInputBalanceBaseUnit: "1000000",
      ownerOutputBalanceBaseUnit: "0",
      permit2: { domainSeparator: `0x${"75".repeat(32)}`, nonce: "0" },
      tokenCode: P05_LOCAL_SWAP_EXECUTION_REGISTRY.tokens.map(({ address, runtimeCodeHash }) => ({
        address,
        runtimeCodeHash,
      })),
    };
    const operationStore = new PostgresLocalSwapOperationStore(pool, { now: () => clock });
    const service = new LocalSwapExecutionService({
      bindings,
      chain: {
        async inspect() {
          return structuredClone(inspection);
        },
      },
      now: () => clock,
      operations: operationStore,
      previews: new PostgresLocalSwapPreviewStore(pool),
      quotes: quoteStore,
    });
    const request = {
      authorizationMode: "direct" as const,
      quoteDigest: quote.quoteDigest,
      walletId,
    };
    const preview = await service.preview({ request, tenantId, userId, wallet });
    const submitted = await service.submit({
      idempotencyKey: "local-swap-recovery-0001",
      request: {
        ...request,
        previewDigest: preview.previewDigest,
        previewToken: preview.previewToken,
      },
      requestId: "request-local-swap-recovery",
      sessionId,
      tenantId,
      userId,
      wallet,
    });
    const operationId = submitted.operation.operationId;
    const repository = new PostgresLocalSwapRecoveryRepository(pool, {
      confirmedPollMilliseconds: 1_000,
      pollMilliseconds: 1_000,
    });

    const approvalQueued = await claimSwap(repository, operationId);
    const originalHash = `0x${"21".repeat(32)}` as const;
    await repository.completeBroadcast({
      claim: approvalQueued,
      deliveredAt: new Date(clock.getTime() + 1),
      result: {
        deliveryId: "local-swap-approve",
        generation: 0,
        planDigest: approvalQueued.operation.planDigest,
        status: "accepted",
        stepId: approvalQueued.operation.step.stepId,
        transactionHash: originalHash,
      },
    });
    const authorization = await repository.prepareReplacement({
      fee: { maxFeePerGasBaseUnit: "21", maxPriorityFeePerGasBaseUnit: "3" },
      now: new Date(clock.getTime() + 2),
      operationId,
      reason: "fixture fee bump",
      stepId: approvalQueued.operation.step.stepId,
    });
    const replacementHash = `0x${"22".repeat(32)}` as const;
    await repository.completeReplacement({
      authorization,
      deliveredAt: new Date(clock.getTime() + 3),
      result: {
        deliveryId: "local-swap-approve-replacement",
        generation: 1,
        planDigest: authorization.plan.planDigest,
        status: "accepted",
        stepId: authorization.stepId,
        transactionHash: replacementHash,
      },
    });
    clock = new Date(clock.getTime() + 1_000);
    const approvalBroadcast = await claimSwap(repository, operationId);
    expect(approvalBroadcast.operation.transactionLineage).toHaveLength(2);
    const original = approvalBroadcast.operation.transactionLineage.find(
      ({ transactionHash }) => transactionHash === originalHash,
    )!;
    await repository.applyObservation({
      claim: approvalBroadcast,
      decision: {
        failureCode: null,
        kind: "receipt",
        next: "advance",
        operationState: "pending",
        reason: null,
        receipt: receipt(approvalBroadcast, {
          allowance: "1000",
          block: 10,
          transactionHash: originalHash,
        }),
        stepState: "succeeded",
        transactionId: original.transactionId,
      },
      observedAt: clock,
    });

    const swapQueued = await claimSwap(repository, operationId);
    expect(swapQueued.operation.step.kind).toBe("swap");
    const swapHash = `0x${"23".repeat(32)}` as const;
    await repository.completeBroadcast({
      claim: swapQueued,
      deliveredAt: new Date(clock.getTime() + 1),
      result: {
        deliveryId: "local-swap-swap",
        generation: 0,
        planDigest: swapQueued.operation.planDigest,
        status: "accepted",
        stepId: swapQueued.operation.step.stepId,
        transactionHash: swapHash,
      },
    });
    clock = new Date(clock.getTime() + 1_000);
    const swapBroadcast = await claimSwap(repository, operationId);
    await repository.applyObservation({
      claim: swapBroadcast,
      decision: {
        failureCode: "SWAP_REVERTED",
        kind: "receipt",
        next: "cleanup-required",
        operationState: "reconciling",
        reason: "ALLOWANCE_CLEANUP_REQUIRED",
        receipt: receipt(swapBroadcast, { allowance: "1000", block: 11, status: "reverted" }),
        stepState: "failed",
        transactionId: swapBroadcast.operation.activeTransaction!.transactionId,
      },
      observedAt: clock,
    });
    const reconciling = await operationStore.get({ operationId, tenantId, userId });
    expect(reconciling).toMatchObject({
      failureCode: "SWAP_REVERTED",
      reconciliationReason: "ALLOWANCE_CLEANUP_REQUIRED",
      state: "reconciling",
    });

    const cleanupQueued = await claimSwap(repository, operationId);
    expect(cleanupQueued.operation.step.kind).toBe("cleanup");
    const cleanupHash = `0x${"24".repeat(32)}` as const;
    await repository.completeBroadcast({
      claim: cleanupQueued,
      deliveredAt: new Date(clock.getTime() + 1),
      result: {
        deliveryId: "local-swap-cleanup",
        generation: 0,
        planDigest: cleanupQueued.operation.planDigest,
        status: "accepted",
        stepId: cleanupQueued.operation.step.stepId,
        transactionHash: cleanupHash,
      },
    });
    clock = new Date(clock.getTime() + 1_000);
    const cleanupBroadcast = await claimSwap(repository, operationId);
    await repository.applyObservation({
      claim: cleanupBroadcast,
      decision: {
        failureCode: "SWAP_REVERTED",
        kind: "receipt",
        next: "complete-failed",
        operationState: "failed",
        reason: null,
        receipt: receipt(cleanupBroadcast, { allowance: "0", block: 12 }),
        stepState: "succeeded",
        transactionId: cleanupBroadcast.operation.activeTransaction!.transactionId,
      },
      observedAt: clock,
    });
    const failed = await operationStore.get({ operationId, tenantId, userId });
    expect(failed).toMatchObject({
      failureCode: "SWAP_REVERTED",
      reconciliationReason: null,
      state: "failed",
    });
    expect(failed!.steps.map(({ kind, state }) => [kind, state])).toEqual([
      ["approve", "succeeded"],
      ["swap", "failed"],
      ["cleanup", "succeeded"],
    ]);
    expect(failed!.steps[0]!.transactions).toEqual([
      expect.objectContaining({ active: true, generation: 0, state: "confirmed" }),
      expect.objectContaining({ active: false, generation: 1, state: "dropped" }),
    ]);
    const closure = await pool.query<{
      evidence_count: string;
      open_reconciliations: string;
      resolved_reconciliations: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM local_swap_receipt_evidence WHERE operation_id = $1)
           AS evidence_count,
         (SELECT count(*)::text FROM local_swap_reconciliation_cases
           WHERE operation_id = $1 AND status = 'open') AS open_reconciliations,
         (SELECT count(*)::text FROM local_swap_reconciliation_cases
           WHERE operation_id = $1 AND status = 'resolved') AS resolved_reconciliations`,
      [operationId],
    );
    expect(closure.rows).toEqual([
      { evidence_count: "3", open_reconciliations: "0", resolved_reconciliations: "1" },
    ]);
    await expect(
      pool.query(
        `UPDATE local_swap_receipt_evidence SET canonical = false WHERE operation_id = $1`,
        [operationId],
      ),
    ).rejects.toThrow(/append-only/u);

    const beforeSuccessLedger = await pool.query<{
      fencing_token: string;
      last_confirmed_nonce: string;
      next_nonce: string;
    }>(
      `SELECT next_nonce::text, last_confirmed_nonce::text, fencing_token::text
         FROM wallet_nonce_ledgers WHERE chain_id = 31337 AND wallet_id = $1`,
      [walletId],
    );
    expect(beforeSuccessLedger.rows[0]).toMatchObject({
      last_confirmed_nonce: "3",
      next_nonce: "4",
    });

    inspection.nonceViews = [
      { latest: "4", pending: "4", providerId: "anvil-a" },
      { latest: "4", pending: "4", providerId: "anvil-b" },
    ];
    const successfulQuote = await quotes.quote({
      amountInBaseUnit: "1000",
      chainId: 31_337,
      slippageBps: 100,
      tenantId,
      tokenIn: P05_LOCAL_SWAP_EXECUTION_REGISTRY.tokens[0].address,
      tokenOut: P05_LOCAL_SWAP_EXECUTION_REGISTRY.tokens[1].address,
      userId,
      walletAddress,
      walletId,
    });
    const successfulRequest = {
      authorizationMode: "direct" as const,
      quoteDigest: successfulQuote.quoteDigest,
      walletId,
    };
    const successfulPreview = await service.preview({
      request: successfulRequest,
      tenantId,
      userId,
      wallet,
    });
    const successfulSubmission = await service.submit({
      idempotencyKey: "local-swap-recovery-success-0001",
      request: {
        ...successfulRequest,
        previewDigest: successfulPreview.previewDigest,
        previewToken: successfulPreview.previewToken,
      },
      requestId: "request-local-swap-recovery-success",
      sessionId,
      tenantId,
      userId,
      wallet,
    });
    const successfulOperationId = successfulSubmission.operation.operationId;

    const successfulApproval = await claimSwap(repository, successfulOperationId);
    expect(successfulApproval.operation.step).toMatchObject({ kind: "approve", nonce: "4" });
    await repository.completeBroadcast({
      claim: successfulApproval,
      deliveredAt: new Date(clock.getTime() + 1),
      result: {
        deliveryId: "local-swap-success-approve",
        generation: 0,
        planDigest: successfulApproval.operation.planDigest,
        status: "accepted",
        stepId: successfulApproval.operation.step.stepId,
        transactionHash: `0x${"31".repeat(32)}`,
      },
    });
    clock = new Date(clock.getTime() + 1_000);
    const successfulApprovalBroadcast = await claimSwap(repository, successfulOperationId);
    await repository.applyObservation({
      claim: successfulApprovalBroadcast,
      decision: {
        failureCode: null,
        kind: "receipt",
        next: "advance",
        operationState: "pending",
        reason: null,
        receipt: receipt(successfulApprovalBroadcast, { allowance: "1000", block: 13 }),
        stepState: "succeeded",
        transactionId: successfulApprovalBroadcast.operation.activeTransaction!.transactionId,
      },
      observedAt: clock,
    });

    const successfulSwap = await claimSwap(repository, successfulOperationId);
    expect(successfulSwap.operation.step).toMatchObject({ kind: "swap", nonce: "5" });
    await repository.completeBroadcast({
      claim: successfulSwap,
      deliveredAt: new Date(clock.getTime() + 1),
      result: {
        deliveryId: "local-swap-success-swap",
        generation: 0,
        planDigest: successfulSwap.operation.planDigest,
        status: "accepted",
        stepId: successfulSwap.operation.step.stepId,
        transactionHash: `0x${"32".repeat(32)}`,
      },
    });
    clock = new Date(clock.getTime() + 1_000);
    const successfulSwapBroadcast = await claimSwap(repository, successfulOperationId);
    await repository.applyObservation({
      claim: successfulSwapBroadcast,
      decision: {
        failureCode: null,
        kind: "receipt",
        next: "complete-success",
        operationState: "succeeded",
        reason: null,
        receipt: receipt(successfulSwapBroadcast, { allowance: "0", block: 14 }),
        stepState: "succeeded",
        transactionId: successfulSwapBroadcast.operation.activeTransaction!.transactionId,
      },
      observedAt: clock,
    });

    const successful = await operationStore.get({
      operationId: successfulOperationId,
      tenantId,
      userId,
    });
    expect(successful).toMatchObject({ state: "succeeded" });
    expect(successful!.steps.map(({ kind, nonce, state }) => [kind, nonce, state])).toEqual([
      ["approve", "4", "succeeded"],
      ["swap", "5", "succeeded"],
      ["cleanup", "6", "skipped"],
    ]);
    const ledger = await pool.query<{
      fencing_token: string;
      last_confirmed_nonce: string;
      next_nonce: string;
    }>(
      `SELECT next_nonce::text, last_confirmed_nonce::text, fencing_token::text
         FROM wallet_nonce_ledgers WHERE chain_id = 31337 AND wallet_id = $1`,
      [walletId],
    );
    expect(ledger.rows[0]).toMatchObject({ last_confirmed_nonce: "5", next_nonce: "6" });
    expect(BigInt(ledger.rows[0]!.fencing_token)).toBe(
      BigInt(beforeSuccessLedger.rows[0]!.fencing_token) + 2n,
    );
  });
});
