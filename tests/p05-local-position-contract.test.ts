import { createHash } from "node:crypto";

import {
  BSC_SWAP_QUOTE_REGISTRY,
  P05_LOCAL_POSITION_EXECUTION_REGISTRY,
  validateLocalPositionExecutionRegistry,
} from "../packages/chain-registry/src/index.js";
import {
  localPositionAccounting,
  localPositionExecutionPlanDigest,
  localPositionLiquidityDelta,
  localPositionMinimumAmount,
  localPositionSnapshotDigest,
  localPositionStepSemanticDigest,
  validateLocalPositionExecutionPlan,
  validateLocalPositionReplacement,
  validateLocalPositionSnapshot,
  type LocalPositionExecutionPlan,
  type LocalPositionPlanStep,
  type LocalPositionSnapshot,
} from "../packages/domain/src/local-position-execution.js";
import { describe, expect, it } from "vitest";

const now = new Date("2026-08-20T06:00:00.000Z");
const registry = P05_LOCAL_POSITION_EXECUTION_REGISTRY;
const wallet = {
  address: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
  walletId: "a7000000-0000-4000-8000-000000000001",
} as const;

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function snapshot(platformId: 1 | 2 | 4 | 5 = 1): LocalPositionSnapshot {
  const v3 = platformId === 1 || platformId === 2;
  const value: LocalPositionSnapshot = {
    block: { hash: `0x${"12".repeat(32)}`, number: "8", timestamp: now.toISOString() },
    chainId: 31_337,
    expiresAt: new Date(now.getTime() + 30_000).toISOString(),
    manager: structuredClone(registry.manager),
    observedAt: now.toISOString(),
    position: {
      approval: { approvedAddress: null, approvedForAll: false, operator: null },
      liquidity: "101",
      owner: wallet.address,
      platformId,
      pool: {
        feePips: "3000",
        poolAddress: v3 ? "0x0000000000000000000000000000000000001234" : null,
        poolId: v3 ? null : `0x${"34".repeat(32)}`,
        tickSpacing: "60",
        token0: registry.tokenPolicy.tokens[0]!.address,
        token1: registry.tokenPolicy.tokens[1]!.address,
      },
      reserve0BaseUnit: "1001",
      reserve1BaseUnit: "2003",
      ticks: { lower: "-120", upper: "120" },
      tokenId: "1",
      tokensOwed0BaseUnit: "11",
      tokensOwed1BaseUnit: "13",
    },
    registry: { digest: registry.registryDigest, version: registry.registryVersion },
    schemaVersion: 2,
    snapshotDigest: `sha256:${"00".repeat(32)}`,
    snapshotVersion: registry.snapshotVersion,
    tokens: [
      {
        address: registry.tokenPolicy.tokens[0]!.address,
        runtimeCodeHash: registry.tokenPolicy.tokens[0]!.runtimeCodeHash,
      },
      {
        address: registry.tokenPolicy.tokens[1]!.address,
        runtimeCodeHash: registry.tokenPolicy.tokens[1]!.runtimeCodeHash,
      },
    ],
    wallet,
  };
  value.snapshotDigest = localPositionSnapshotDigest(value);
  return value;
}

function step(ordinal: number, kind: "decrease" | "collect" | "burn"): LocalPositionPlanStep {
  const selector =
    kind === "decrease"
      ? registry.manager.selectors.decreaseLiquidity
      : registry.manager.selectors[kind];
  const value: LocalPositionPlanStep = {
    feeLimit: {
      feeCapBaseUnit: "400000",
      gasLimit: "100000",
      maxFeePerGasBaseUnit: "4",
      maxPriorityFeePerGasBaseUnit: "2",
    },
    fencingToken: String(ordinal + 1),
    kind,
    nonce: String(ordinal + 8),
    ordinal,
    runCondition: "always",
    semanticDigest: `sha256:${"00".repeat(32)}`,
    stepId: `a7000000-0000-4000-8000-00000000001${ordinal}`,
    transaction: {
      data: `${selector}${"00".repeat(32)}`,
      dataDigest: digest(`${kind}-data`),
      to: registry.manager.address,
      valueBaseUnit: "0",
    },
  };
  value.semanticDigest = localPositionStepSemanticDigest(value);
  return value;
}

function plan(): LocalPositionExecutionPlan {
  const state = snapshot();
  const action = {
    burnIfEmpty: true,
    kind: "remove-liquidity",
    percent: 100,
    slippageBps: 100,
  } as const;
  const value: LocalPositionExecutionPlan = {
    accounting: localPositionAccounting(state, action),
    action,
    chainId: 31_337,
    deadline: new Date(now.getTime() + 600_000).toISOString(),
    manager: structuredClone(registry.manager),
    operationId: "a7000000-0000-4000-8000-000000000020",
    planDigest: `sha256:${"00".repeat(32)}`,
    planVersion: registry.planVersion,
    registry: {
      digest: registry.registryDigest,
      rollbackVersion: registry.rollbackVersion,
      version: registry.registryVersion,
    },
    schemaVersion: 2,
    serviceFeeBps: 0,
    snapshot: state,
    steps: [step(0, "decrease"), step(1, "collect"), step(2, "burn")],
    wallet,
  };
  value.planDigest = localPositionExecutionPlanDigest(value);
  return value;
}

describe("P05-07 local position Registry, snapshot and plan", () => {
  it("opens only the non-forked local gate and fixes manager ABI/code/selectors/platforms", () => {
    expect(validateLocalPositionExecutionRegistry()).toBe(registry);
    expect(registry.platforms).toEqual([
      { generation: "v3", platformId: 1 },
      { generation: "v3", platformId: 2 },
      { generation: "v4", platformId: 4 },
      { generation: "v4", platformId: 5 },
    ]);
    expect(registry.manager.selectors).toEqual({
      burn: "0x42966c68",
      collect: "0xfc6f7865",
      decreaseLiquidity: "0x0c49ccbe",
    });
    expect(registry.gates.local.status).toBe("OPEN");
    expect(registry.gates.bsc.status).toBe("CLOSED");
    expect(registry.gates.testnet.status).toBe("CLOSED");
    expect(registry.gates.production.status).toBe("CLOSED");
    expect(BSC_SWAP_QUOTE_REGISTRY.executionEnabled).toBe(false);
  });

  it.each([1, 2, 4, 5] as const)("validates platform %s snapshot identity", (platformId) => {
    const value = snapshot(platformId);
    expect(() => validateLocalPositionSnapshot(value, now)).not.toThrow();
    value.position.approval.approvedForAll = true;
    expect(() => validateLocalPositionSnapshot(value, now)).toThrow(
      "LOCAL_POSITION_SNAPSHOT_INVALID",
    );
  });

  it.each([
    [1, "1"],
    [25, "25"],
    [50, "50"],
    [99, "99"],
    [100, "101"],
  ] as const)(
    "calculates %s%% liquidity with deterministic floor rounding",
    (percent, expected) => {
      expect(localPositionLiquidityDelta("101", percent)).toBe(expected);
    },
  );

  it("rejects a percentage that rounds to zero and derives principal/minimums", () => {
    expect(() => localPositionLiquidityDelta("50", 1)).toThrow(
      "LOCAL_POSITION_ZERO_LIQUIDITY_DELTA",
    );
    expect(localPositionMinimumAmount("247", 100)).toBe("244");
    expect(
      localPositionAccounting(snapshot(), {
        burnIfEmpty: false,
        kind: "remove-liquidity",
        percent: 25,
        slippageBps: 100,
      }),
    ).toMatchObject({
      collectTotal0BaseUnit: "258",
      collectTotal1BaseUnit: "508",
      feeProceeds0BaseUnit: "11",
      feeProceeds1BaseUnit: "13",
      liquidityDelta: "25",
      minPrincipal0BaseUnit: "244",
      minPrincipal1BaseUnit: "490",
      principal0BaseUnit: "247",
      principal1BaseUnit: "495",
      remainingLiquidity: "76",
    });
  });

  it("validates decrease -> collect -> burn and freezes replacement semantics", () => {
    const value = plan();
    expect(() =>
      validateLocalPositionExecutionPlan(
        value,
        {
          currentBlockHash: value.snapshot.block.hash,
          currentBlockNumber: value.snapshot.block.number,
          expectedAccounting: structuredClone(value.accounting),
          expectedAction: structuredClone(value.action),
          expectedManager: structuredClone(value.manager),
          expectedSnapshot: structuredClone(value.snapshot),
          expectedSteps: structuredClone(value.steps),
          expectedWallet: structuredClone(value.wallet),
          registryDigest: registry.registryDigest,
        },
        now,
      ),
    ).not.toThrow();

    const selected = value.steps[1]!;
    const previous = {
      dataDigest: selected.transaction.dataDigest,
      fee: { maxFeePerGasBaseUnit: "2", maxPriorityFeePerGasBaseUnit: "1" },
      nonce: selected.nonce,
      planDigest: value.planDigest,
      semanticDigest: selected.semanticDigest,
      target: selected.transaction.to,
    } as const;
    expect(() =>
      validateLocalPositionReplacement(
        selected,
        previous,
        {
          ...previous,
          fee: { maxFeePerGasBaseUnit: "3", maxPriorityFeePerGasBaseUnit: "1" },
        },
        value.planDigest,
      ),
    ).not.toThrow();
    expect(() =>
      validateLocalPositionReplacement(
        selected,
        previous,
        {
          ...previous,
          dataDigest: digest("injected-recipient"),
          fee: { maxFeePerGasBaseUnit: "3", maxPriorityFeePerGasBaseUnit: "1" },
        },
        value.planDigest,
      ),
    ).toThrow("LOCAL_POSITION_REPLACEMENT_INVALID");
  });
});
