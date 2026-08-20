import {
  localHelperSweepRegistryDigest,
  P05_LOCAL_HELPER_SWEEP_REGISTRY,
  validateLocalHelperSweepRegistry,
} from "../packages/chain-registry/src/index.js";
import {
  localHelperResidualSnapshotDigest,
  localHelperSweepCalldata,
  localHelperSweepDataDigest,
  localHelperSweepPlanDigest,
  localHelperSweepSemanticDigest,
  validateLocalHelperResidualSnapshot,
  validateLocalHelperSweepPlan,
  validateLocalHelperSweepReplacement,
  type LocalHelperResidualSnapshot,
  type LocalHelperSweepBinding,
  type LocalHelperSweepPlan,
} from "../packages/domain/src/local-helper-sweep.js";
import { describe, expect, it } from "vitest";

const now = new Date("2026-08-20T08:00:00.000Z");
const registry = P05_LOCAL_HELPER_SWEEP_REGISTRY;
const wallet = {
  address: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
  walletId: "a8000000-0000-4000-8000-000000000001",
} as const;
const bindingBase = {
  adapterAddress: registry.components.find(({ role }) => role === "adapter")!.address,
  bindingId: "a8000000-0000-4000-8000-000000000002",
  deploymentRegistryVersion: "p05-local-helper-deployment-v2",
  helperAddress: "0x1234567890123456789012345678901234567890",
  helperVersion: "WalletHelperV1",
  ownerAddress: wallet.address,
  permit2Address: registry.components.find(({ role }) => role === "permit2")!.address,
  runtimeCodeHash: `0x${"ab".repeat(32)}`,
  verifiedBlockNumber: "7",
} as const;

function snapshot(input: {
  allowance?: string;
  native?: string;
  owner?: `0x${string}` | null;
  tokenA?: string;
  unknown?: boolean;
} = {}): LocalHelperResidualSnapshot {
  const allowance = input.allowance ?? "0";
  const native = input.native ?? registry.dustPolicy.nativeDustBaseUnit;
  const tokenA = input.tokenA ?? registry.dustPolicy.tokenDustBaseUnit;
  const observedOwner = input.owner === undefined ? wallet.address : input.owner;
  const reasons = [
    ...(allowance !== "0" ? ["nonzero-allowance"] : []),
    ...(BigInt(native) > BigInt(registry.dustPolicy.nativeDustBaseUnit) ||
    BigInt(tokenA) > BigInt(registry.dustPolicy.tokenDustBaseUnit)
      ? ["residual-above-dust"]
      : []),
    ...(input.unknown ? ["unknown-token"] : []),
    ...(observedOwner !== wallet.address ? ["identity-mismatch"] : []),
  ].sort();
  const binding: LocalHelperSweepBinding = {
    ...bindingBase,
    state: reasons.length === 0 ? "active" : "degraded",
  };
  const value: LocalHelperResidualSnapshot = {
    allowances: [
      {
        amountBaseUnit: allowance,
        assetId: `allowance:${registry.tokens[0].address}:${registry.components[0].address}`,
        spenderAddress: registry.components[0].address,
        spenderRole: "adapter",
        tokenAddress: registry.tokens[0].address,
      },
    ],
    balances: [
      {
        amountBaseUnit: native,
        assetId: "native:31337",
        dustBaseUnit: registry.dustPolicy.nativeDustBaseUnit,
        fixture: null,
        kind: "native",
        runtimeCodeHash: null,
        tokenAddress: null,
      },
      ...registry.tokens.map((token, index) => ({
        amountBaseUnit: index === 0 ? tokenA : "0",
        assetId: `token:${token.address}`,
        dustBaseUnit: token.dustBaseUnit,
        fixture: token.fixture,
        kind: "token" as const,
        runtimeCodeHash: token.runtimeCodeHash,
        tokenAddress: token.address,
      })),
    ],
    binding,
    block: {
      hash: `0x${"12".repeat(32)}`,
      number: "8",
      timestamp: new Date(now.getTime() - 2_000).toISOString(),
    },
    chainId: 31_337,
    coverage: {
      allowancesComplete: true,
      complete: true,
      helperIdentityComplete: true,
      nftCustodyComplete: true,
      tokenInventoryComplete: true,
    },
    degradationReasons: reasons,
    expiresAt: new Date(now.getTime() + 30_000).toISOString(),
    identity: {
      bindingMatches: true,
      componentsMatch: true,
      observedOwner,
      observedRuntimeCodeHash: binding.runtimeCodeHash,
      ownerMatches: observedOwner === binding.ownerAddress,
      registryMatches: true,
      runtimeMatches: true,
      tokensMatch: true,
    },
    manualRecoveryRequired: allowance !== "0" || Boolean(input.unknown),
    nftCustody: [],
    observedAt: now.toISOString(),
    registry: { digest: registry.registryDigest, version: registry.registryVersion },
    schemaVersion: 2,
    snapshotDigest: `sha256:${"00".repeat(32)}`,
    snapshotVersion: registry.snapshotVersion,
    unknownTokens: input.unknown
      ? [
          {
            amountBaseUnit: "9",
            assetId: "unknown-token:0x9999999999999999999999999999999999999999",
            runtimeCodeHash: `0x${"99".repeat(32)}`,
            tokenAddress: "0x9999999999999999999999999999999999999999",
          },
        ]
      : [],
    wallet,
  };
  value.snapshotDigest = localHelperResidualSnapshotDigest(value);
  return value;
}

function snapshotContext(value: LocalHelperResidualSnapshot) {
  return {
    binding: value.binding,
    nativeDustBaseUnit: registry.dustPolicy.nativeDustBaseUnit,
    registryDigest: registry.registryDigest,
    registryVersion: registry.registryVersion,
    tokenPolicy: registry.tokens,
    wallet,
  } as const;
}

function plan(): LocalHelperSweepPlan {
  const state = snapshot({ tokenA: "2" });
  const asset = state.balances.find(({ assetId }) => assetId === `token:${registry.tokens[0].address}`)!;
  const { state: _state, ...helper } = state.binding;
  const value: LocalHelperSweepPlan = {
    asset,
    batchId: "a8000000-0000-4000-8000-000000000010",
    chainId: 31_337,
    deadline: new Date(now.getTime() + 600_000).toISOString(),
    feeLimit: {
      feeCapBaseUnit: "400000",
      gasLimit: "100000",
      maxFeePerGasBaseUnit: "4",
      maxPriorityFeePerGasBaseUnit: "2",
    },
    fencingToken: "11",
    helper,
    nonce: "8",
    operationId: "a8000000-0000-4000-8000-000000000011",
    planDigest: `sha256:${"00".repeat(32)}`,
    planVersion: registry.planVersion,
    recipient: wallet.address,
    registry: {
      digest: registry.registryDigest,
      rollbackVersion: registry.rollbackVersion,
      version: registry.registryVersion,
    },
    schemaVersion: 2,
    semanticDigest: `sha256:${"00".repeat(32)}`,
    serviceFeeBps: 0,
    snapshot: {
      blockHash: state.block.hash,
      blockNumber: state.block.number,
      digest: state.snapshotDigest,
    },
    transaction: {
      data: "0x",
      dataDigest: `sha256:${"00".repeat(32)}`,
      selector: registry.helper.selectors.sweepToken,
      to: state.binding.helperAddress,
      valueBaseUnit: "0",
    },
    wallet,
  };
  value.planDigest = localHelperSweepPlanDigest(value);
  value.transaction.data = localHelperSweepCalldata(value.planDigest, value.asset);
  value.transaction.dataDigest = localHelperSweepDataDigest(value.transaction.data);
  value.semanticDigest = localHelperSweepSemanticDigest(value);
  return value;
}

describe("P05-08 local Helper sweep contract", () => {
  it("freezes Registry identities, selectors, dust and local-only gates", () => {
    expect(validateLocalHelperSweepRegistry()).toBe(registry);
    expect(registry).toMatchObject({
      chainId: 31_337,
      dustPolicy: { nativeDustBaseUnit: "1000", tokenDustBaseUnit: "1" },
      gates: {
        bsc: { status: "CLOSED" },
        local: { broadcasts: true, signatures: true, status: "OPEN" },
        production: { status: "CLOSED" },
        testnet: { status: "CLOSED" },
      },
      helper: {
        selectors: { owner: "0x8da5cb5b", sweepNative: "0x6971b189", sweepToken: "0x3609afa9" },
      },
      registryVersion: "p05-local-helper-sweep-v2",
    });
    const changed = structuredClone(registry);
    changed.dustPolicy.nativeDustBaseUnit = "0";
    changed.registryDigest = localHelperSweepRegistryDigest(changed);
    expect(() => validateLocalHelperSweepRegistry(changed)).toThrow(
      "LOCAL_HELPER_SWEEP_REGISTRY_INVALID",
    );
  });

  it("treats exact dust as active and residual above dust as degraded", () => {
    const boundary = snapshot();
    expect(() => validateLocalHelperResidualSnapshot(boundary, snapshotContext(boundary), now)).not.toThrow();
    expect(boundary.binding.state).toBe("active");
    const residual = snapshot({ native: "1001" });
    expect(() => validateLocalHelperResidualSnapshot(residual, snapshotContext(residual), now)).not.toThrow();
    expect(residual).toMatchObject({
      binding: { state: "degraded" },
      degradationReasons: ["residual-above-dust"],
    });
  });

  it("records authority, custody and owner mismatches without creating sweep authority", () => {
    const manual = snapshot({ allowance: "1", unknown: true });
    expect(() => validateLocalHelperResidualSnapshot(manual, snapshotContext(manual), now)).not.toThrow();
    expect(manual.manualRecoveryRequired).toBe(true);
    expect(manual.degradationReasons).toEqual(["nonzero-allowance", "unknown-token"]);
    const mismatch = snapshot({ owner: registry.tokens[0].address });
    expect(() => validateLocalHelperResidualSnapshot(mismatch, snapshotContext(mismatch), now)).not.toThrow();
    expect(mismatch.degradationReasons).toEqual(["identity-mismatch"]);
  });

  it("derives fixed token calldata and rejects amount, recipient, target and calldata injection", () => {
    const value = plan();
    const context = {
      currentBlockHash: value.snapshot.blockHash,
      currentBlockNumber: value.snapshot.blockNumber,
      expectedAsset: value.asset,
      expectedBinding: { ...value.helper, state: "degraded" as const },
      expectedWallet: wallet,
      registryDigest: registry.registryDigest,
    };
    expect(() => validateLocalHelperSweepPlan(value, context, now)).not.toThrow();
    expect(value.transaction.data).toBe(
      `0x3609afa9${value.planDigest.slice(7)}${value.asset.tokenAddress!.slice(2).padStart(64, "0")}${BigInt(value.asset.amountBaseUnit).toString(16).padStart(64, "0")}`,
    );
    for (const mutate of [
      (candidate: LocalHelperSweepPlan) => (candidate.asset.amountBaseUnit = "3"),
      (candidate: LocalHelperSweepPlan) => (candidate.recipient = registry.tokens[1].address),
      (candidate: LocalHelperSweepPlan) => (candidate.transaction.to = registry.tokens[1].address),
      (candidate: LocalHelperSweepPlan) => (candidate.transaction.data = "0x3609afa9"),
    ]) {
      const candidate = structuredClone(value);
      mutate(candidate);
      expect(() => validateLocalHelperSweepPlan(candidate, context, now)).toThrow(
        "LOCAL_HELPER_SWEEP_PLAN_INVALID",
      );
    }
  });

  it("allows replacement fee bumps only and freezes every asset semantic", () => {
    const value = plan();
    const previous = {
      amountBaseUnit: value.asset.amountBaseUnit,
      assetId: value.asset.assetId,
      dataDigest: value.transaction.dataDigest,
      fee: { maxFeePerGasBaseUnit: "2", maxPriorityFeePerGasBaseUnit: "1" },
      nonce: value.nonce,
      planDigest: value.planDigest,
      recipient: value.recipient,
      semanticDigest: value.semanticDigest,
      target: value.transaction.to,
    };
    expect(() =>
      validateLocalHelperSweepReplacement(value, previous, {
        ...previous,
        fee: { maxFeePerGasBaseUnit: "3", maxPriorityFeePerGasBaseUnit: "1" },
      }),
    ).not.toThrow();
    expect(() =>
      validateLocalHelperSweepReplacement(value, previous, {
        ...previous,
        amountBaseUnit: "3",
        fee: { maxFeePerGasBaseUnit: "3", maxPriorityFeePerGasBaseUnit: "1" },
      }),
    ).toThrow("LOCAL_HELPER_SWEEP_REPLACEMENT_INVALID");
  });
});
