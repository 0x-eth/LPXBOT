import { createHash } from "node:crypto";

import {
  LocalSwapQuoteAdapter,
  isLocalSwapQuoteCurrent,
  verifyLocalSwapQuoteDigest,
  type LocalSwapQuoteProvider,
} from "../packages/chain-adapters/src/index.js";
import {
  BSC_SWAP_QUOTE_REGISTRY,
  localSwapComponent,
  P05_LOCAL_SWAP_EXECUTION_REGISTRY,
  validateLocalSwapExecutionRegistry,
} from "../packages/chain-registry/src/index.js";
import {
  LOCAL_SWAP_EXECUTION_PLAN_VERSION,
  localSwapExecutionPlanDigest,
  localSwapStepSemanticDigest,
  validateLocalSwapExecutionPlan,
  validateLocalSwapReplacement,
  type LocalSwapExecutionPlan,
  type LocalSwapPlanStep,
  type LocalSwapPlanValidationContext,
} from "../packages/domain/src/local-swap-execution.js";
import { describe, expect, it } from "vitest";

const now = new Date("2026-08-20T02:00:00.000Z");
const registry = P05_LOCAL_SWAP_EXECUTION_REGISTRY;
const wallet = {
  address: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
  walletId: "a6000000-0000-4000-8000-000000000001",
} as const;
const helper = {
  adapter: localSwapComponent("adapter").address,
  address: "0x0165878a594ca255338adfa4d48449f69242eb8f",
  bindingId: "a6000000-0000-4000-8000-000000000002",
  helperVersion: "WalletHelperV1",
  owner: wallet.address,
  permit2: localSwapComponent("permit2").address,
  runtimeCodeHash: `0x${"91".repeat(32)}`,
  verifiedBlockNumber: "7",
} as const;

function digest(bytes: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function provider(): LocalSwapQuoteProvider {
  return {
    async inspect() {
      return {
        amountOutBaseUnit: "2000",
        blockHash: `0x${"12".repeat(32)}` as const,
        blockNumber: "7",
        blockTimestamp: now.toISOString(),
        componentCode: registry.components.map((component) => ({ ...component })),
        gasLimit: "500000",
        helper: {
          adapter: helper.adapter,
          codeHash: helper.runtimeCodeHash,
          owner: helper.owner,
          permit2: helper.permit2,
        },
        maxFeePerGasBaseUnit: "20",
        maxPriorityFeePerGasBaseUnit: "2",
        providerSnapshotId: "a6000000-0000-4000-8000-000000000003",
        tokenCode: registry.tokens.map(({ address, runtimeCodeHash }) => ({
          address,
          runtimeCodeHash,
        })),
      };
    },
  };
}

function step(
  ordinal: number,
  kind: LocalSwapPlanStep["kind"],
  to: `0x${string}`,
): LocalSwapPlanStep {
  const value: LocalSwapPlanStep = {
    feeLimit: {
      feeCapBaseUnit: "2000000",
      gasLimit: "100000",
      maxFeePerGasBaseUnit: "20",
      maxPriorityFeePerGasBaseUnit: "2",
    },
    fencingToken: String(ordinal + 11),
    kind,
    nonce: String(ordinal + 8),
    ordinal,
    runCondition: kind === "cleanup" ? "swap-failed-after-approval" : "always",
    semanticDigest: `sha256:${"00".repeat(32)}`,
    stepId: `a6000000-0000-4000-8000-00000000001${ordinal}`,
    transaction: {
      data: `0x${String(ordinal + 1).padStart(2, "0")}`,
      dataDigest: digest(String(ordinal + 1)),
      to,
      valueBaseUnit: "0",
    },
  };
  value.semanticDigest = localSwapStepSemanticDigest(value);
  return value;
}

function plan(mode: "direct" | "permit2" = "direct"): {
  context: LocalSwapPlanValidationContext;
  value: LocalSwapExecutionPlan;
} {
  const quote: LocalSwapExecutionPlan["quote"] = {
    amountInBaseUnit: "1000",
    amountOutBaseUnit: "2000",
    blockHash: `0x${"12".repeat(32)}`,
    blockNumber: "7",
    deadline: "2026-08-20T02:01:20.000Z",
    expiresAt: "2026-08-20T02:00:20.000Z",
    maxBlockNumber: "12",
    minOutBaseUnit: "1980",
    quoteDigest: digest("quote"),
    quoteVersion: "p05-local-swap-quote-v2",
    tokenIn: registry.tokens[0].address,
    tokenOut: registry.tokens[1].address,
  };
  const approvalSpender = mode === "direct" ? helper.address : helper.permit2;
  const steps = [
    step(0, "approve", registry.tokens[0].address),
    step(1, "swap", helper.address),
    step(2, "cleanup", registry.tokens[0].address),
  ];
  const signature = `0x${"44".repeat(65)}` as const;
  const value: LocalSwapExecutionPlan = {
    authorization:
      mode === "direct"
        ? { approvalSpender, mode, permit2: null }
        : {
            approvalSpender,
            mode,
            permit2: {
              amountBaseUnit: quote.amountInBaseUnit,
              domainSeparator: `0x${"33".repeat(32)}`,
              expiration: "1787192400",
              nonce: "4",
              permit2: helper.permit2,
              sigDeadline: "1787191280",
              signature,
              signatureDigest: `sha256:${createHash("sha256")
                .update(Buffer.from(signature.slice(2), "hex"))
                .digest("hex")}`,
              spender: helper.address,
              token: quote.tokenIn,
            },
          },
    chainId: 31_337,
    deadline: "2026-08-20T02:10:00.000Z",
    helper,
    helperPlanDigest: `0x${"22".repeat(32)}`,
    operationId: "a6000000-0000-4000-8000-000000000020",
    planDigest: `sha256:${"00".repeat(32)}`,
    planVersion: LOCAL_SWAP_EXECUTION_PLAN_VERSION,
    quote,
    registry: {
      digest: registry.registryDigest,
      rollbackVersion: registry.rollbackVersion,
      version: registry.registryVersion,
    },
    schemaVersion: 2,
    serviceFeeBps: 0,
    steps,
    wallet,
  };
  value.planDigest = localSwapExecutionPlanDigest(value);
  return {
    context: {
      authorizationMode: mode,
      currentBlockNumber: "8",
      expectedHelper: structuredClone(helper),
      expectedHelperPlanDigest: value.helperPlanDigest,
      expectedQuote: structuredClone(quote),
      expectedSteps: structuredClone(steps),
      expectedWallet: structuredClone(wallet),
      registryDigest: registry.registryDigest,
      registryRollbackVersion: registry.rollbackVersion,
      registryVersion: registry.registryVersion,
    },
    value,
  };
}

describe("P05-06 local Swap quote and execution contracts", () => {
  it("adds an isolated v2 local Registry without opening BSC execution", () => {
    expect(validateLocalSwapExecutionRegistry()).toBe(registry);
    expect(registry.registryVersion).toBe("p05-local-swap-execution-v2");
    expect(registry.gates.local.status).toBe("OPEN");
    expect(registry.gates.testnet.status).toBe("CLOSED");
    expect(registry.gates.production.status).toBe("CLOSED");
    expect(registry.serviceFeeBps).toBe(0);
    expect(registry.helper).not.toHaveProperty("address");
    expect(BSC_SWAP_QUOTE_REGISTRY.registryVersion).toBe("p05-bsc-execution-v1");
    expect(BSC_SWAP_QUOTE_REGISTRY.executionEnabled).toBe(false);
  });

  it("creates a current executable quote v2 bound to synthetic code identities", async () => {
    const adapter = new LocalSwapQuoteAdapter({ now: () => now, provider: provider() });
    const quote = await adapter.quote({
      amountInBaseUnit: "1000",
      chainId: 31_337,
      helper,
      slippageBps: 100,
      tokenIn: registry.tokens[0].address,
      tokenOut: registry.tokens[1].address,
      walletAddress: wallet.address,
      walletId: wallet.walletId,
    });
    expect(quote).toMatchObject({
      amountOutBaseUnit: "2000",
      executionEnabled: true,
      minOutBaseUnit: "1980",
      quoteVersion: "p05-local-swap-quote-v2",
      serviceFeeBps: 0,
    });
    expect(verifyLocalSwapQuoteDigest(quote)).toBe(true);
    expect(isLocalSwapQuoteCurrent(quote, { blockNumber: "8", now })).toBe(true);
  });

  it.each(["direct", "permit2"] as const)("validates the %s ordered step plan", (mode) => {
    const fixture = plan(mode);
    expect(() => validateLocalSwapExecutionPlan(fixture.value, fixture.context, now)).not.toThrow();
  });

  it("rejects arbitrary calldata and non-increasing or semantic-changing replacement", () => {
    const fixture = plan();
    fixture.value.steps[1]!.transaction.data = "0xdeadbeef";
    fixture.value.steps[1]!.transaction.dataDigest = digest("tampered");
    fixture.value.steps[1]!.semanticDigest = localSwapStepSemanticDigest(fixture.value.steps[1]!);
    fixture.value.planDigest = localSwapExecutionPlanDigest(fixture.value);
    expect(() => validateLocalSwapExecutionPlan(fixture.value, fixture.context, now)).toThrow(
      "LOCAL_SWAP_STEP_SET_INVALID",
    );

    const stepValue = plan().value.steps[1]!;
    const previous = {
      dataDigest: stepValue.transaction.dataDigest,
      fee: { maxFeePerGasBaseUnit: "10", maxPriorityFeePerGasBaseUnit: "1" },
      nonce: stepValue.nonce,
      planDigest: plan().value.planDigest,
      semanticDigest: stepValue.semanticDigest,
      target: stepValue.transaction.to,
    } as const;
    expect(() =>
      validateLocalSwapReplacement(stepValue, previous, { ...previous }, previous.planDigest),
    ).toThrow("LOCAL_SWAP_REPLACEMENT_INVALID");
    expect(() =>
      validateLocalSwapReplacement(
        stepValue,
        previous,
        {
          ...previous,
          fee: { maxFeePerGasBaseUnit: "11", maxPriorityFeePerGasBaseUnit: "1" },
          target: wallet.address,
        },
        previous.planDigest,
      ),
    ).toThrow("LOCAL_SWAP_REPLACEMENT_INVALID");
  });
});
