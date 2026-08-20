import type { CustodyWallet, LocalHelperSweepBatch } from "@lpbot/api-contract";
import { localHelperV1SupersedeDecision } from "@lpbot/domain/local-helper-upgrade";
import type { LocalHelperResidualSnapshot } from "@lpbot/domain/local-helper-sweep";

import type { LocalHelperSweepApplication } from "./local-helper-sweeps.js";
import type { WalletDirectory } from "./wallets.js";

interface UpgradeSweepOperation {
  operationId: string;
  plan: {
    source: { bindingId: string; helperAddress: `0x${string}` };
    wallet: { address: `0x${string}`; walletId: string };
  };
  reauthenticatedSessionId: string;
  sweepBatchId: string | null;
  tenantId: string;
  userId: string;
}

export type LocalHelperUpgradeSweepGatewayResult =
  | { batchId: string | null; kind: "completed" }
  | { batchId: string; kind: "pending" }
  | { batchId: string | null; blockers: string[]; kind: "manual-recovery-required" };

export class LocalHelperUpgradeSweepGatewayError extends Error {
  constructor(
    readonly code: string,
    readonly retryable = false,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = "LocalHelperUpgradeSweepGatewayError";
  }
}

export class LocalHelperUpgradeSweepGateway {
  readonly #idempotencyKey: () => string;
  readonly #sweeps: LocalHelperSweepApplication;
  readonly #wallets: WalletDirectory;

  constructor(input: {
    idempotencyKey?: () => string;
    sweeps: LocalHelperSweepApplication;
    wallets: WalletDirectory;
  }) {
    this.#idempotencyKey =
      input.idempotencyKey ?? (() => `upgrade-rescan-${crypto.randomUUID().toLowerCase()}`);
    this.#sweeps = input.sweeps;
    this.#wallets = input.wallets;
  }

  async sweep(operation: UpgradeSweepOperation): Promise<LocalHelperUpgradeSweepGatewayResult> {
    const wallet = await this.#wallet(operation);
    if (operation.sweepBatchId) {
      const batch = await this.#sweeps.getBatch({
        batchId: operation.sweepBatchId,
        tenantId: operation.tenantId,
        userId: operation.userId,
      });
      return this.#batchResult(batch);
    }
    const snapshot = await this.#scan(operation, wallet);
    const decision = localHelperV1SupersedeDecision(snapshot);
    if (decision.manualRecoveryRequired) {
      return {
        batchId: null,
        blockers: decision.blockers,
        kind: "manual-recovery-required",
      };
    }
    const residualOnlyDegradation =
      snapshot.binding.state === "degraded" &&
      snapshot.coverage.complete &&
      snapshot.identity.bindingMatches &&
      snapshot.identity.componentsMatch &&
      snapshot.identity.ownerMatches &&
      snapshot.identity.registryMatches &&
      snapshot.identity.runtimeMatches &&
      snapshot.identity.tokensMatch &&
      snapshot.degradationReasons.length > 0 &&
      snapshot.degradationReasons.every((reason) => reason === "residual-above-dust");
    const identityBlockers = decision.blockers.filter(
      (blocker) =>
        blocker !== "BALANCE_ABOVE_DUST" &&
        !(blocker === "V1_IDENTITY_MISMATCH" && residualOnlyDegradation),
    );
    if (identityBlockers.length > 0) {
      throw new LocalHelperUpgradeSweepGatewayError("HELPER_UPGRADE_SWEEP_PREFLIGHT_CHANGED", true);
    }
    const assetIds = snapshot.balances
      .filter(({ amountBaseUnit, dustBaseUnit }) => BigInt(amountBaseUnit) > BigInt(dustBaseUnit))
      .map(({ assetId }) => assetId);
    if (assetIds.length === 0) return { batchId: null, kind: "completed" };
    const preview = await this.#sweeps.preview({
      request: {
        assetIds,
        chainId: 31_337,
        snapshotDigest: snapshot.snapshotDigest,
        walletId: wallet.walletId,
      },
      tenantId: operation.tenantId,
      userId: operation.userId,
      wallet,
    });
    const result = await this.#sweeps.sweep({
      idempotencyKey: `upgrade-sweep-${operation.operationId}`,
      request: {
        assetIds,
        chainId: 31_337,
        previewDigest: preview.previewDigest,
        previewToken: preview.previewToken,
        snapshotDigest: snapshot.snapshotDigest,
        walletId: wallet.walletId,
      },
      requestId: operation.operationId,
      sessionId: operation.reauthenticatedSessionId,
      tenantId: operation.tenantId,
      upgradeOperationId: operation.operationId,
      userId: operation.userId,
      wallet,
    });
    return this.#batchResult(result.batch);
  }

  async finalRescan(operation: UpgradeSweepOperation): Promise<LocalHelperResidualSnapshot> {
    const wallet = await this.#wallet(operation);
    return this.#scan(operation, wallet);
  }

  async #scan(
    operation: UpgradeSweepOperation,
    wallet: CustodyWallet,
  ): Promise<LocalHelperResidualSnapshot> {
    const snapshot = await this.#sweeps.scan({
      idempotencyKey: this.#idempotencyKey(),
      tenantId: operation.tenantId,
      userId: operation.userId,
      wallet,
    });
    if (
      snapshot.binding.bindingId !== operation.plan.source.bindingId ||
      snapshot.binding.helperAddress !== operation.plan.source.helperAddress ||
      snapshot.wallet.walletId !== operation.plan.wallet.walletId ||
      snapshot.wallet.address !== operation.plan.wallet.address
    ) {
      throw new LocalHelperUpgradeSweepGatewayError("HELPER_UPGRADE_SWEEP_BINDING_MISMATCH");
    }
    return structuredClone(snapshot) as LocalHelperResidualSnapshot;
  }

  async #wallet(operation: UpgradeSweepOperation): Promise<CustodyWallet> {
    const wallet = await this.#wallets.getWallet(operation.userId, operation.plan.wallet.walletId);
    if (
      !wallet ||
      wallet.address !== operation.plan.wallet.address ||
      wallet.lockStatus !== "ready"
    ) {
      throw new LocalHelperUpgradeSweepGatewayError("WALLET_LOCKED");
    }
    return wallet;
  }

  #batchResult(batch: LocalHelperSweepBatch): LocalHelperUpgradeSweepGatewayResult {
    if (batch.state === "succeeded") return { batchId: batch.batchId, kind: "completed" };
    if (["queued", "running", "reconciling"].includes(batch.state)) {
      return { batchId: batch.batchId, kind: "pending" };
    }
    return {
      batchId: batch.batchId,
      blockers: [`P05_08_${batch.state.toUpperCase().replaceAll("-", "_")}`],
      kind: "manual-recovery-required",
    };
  }
}
