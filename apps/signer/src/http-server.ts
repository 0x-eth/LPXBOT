import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import type { DeleteCustodyWalletRequest, WalletDeleteDependencies } from "@lpbot/api-contract";
import type { HelperDeploymentPlan } from "@lpbot/domain/helper-deployment";
import type {
  LocalSwapExecutionPlan,
  LocalSwapPermit2SigningPayload,
} from "@lpbot/domain/local-swap-execution";
import type { LocalPositionExecutionPlan } from "@lpbot/domain/local-position-execution";
import type { LocalHelperSweepPlan } from "@lpbot/domain/local-helper-sweep";
import type { LocalHelperUpgradePlan } from "@lpbot/domain/local-helper-upgrade";
import {
  transferDigestPattern,
  validateWalletTransferPlan,
  type WalletTransferPlan,
} from "@lpbot/domain/wallet-transfer";

import type { CustodySignerService } from "./custody-signer-service.js";
import { SignerError, asSignerError } from "./signer-error.js";

const bodyLimit = 16_384;
const helperDeploymentBodyLimit = 65_536;
const localSwapPlanBodyLimit = 131_072;
const localPositionPlanBodyLimit = 131_072;
const localHelperSweepPlanBodyLimit = 65_536;
const localHelperUpgradePlanBodyLimit = 131_072;
const identityPattern = /^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$/u;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function tokenDigest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function authorized(request: IncomingMessage, expectedDigest: Buffer): boolean {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) return false;
  const received = tokenDigest(authorization.slice("Bearer ".length));
  return timingSafeEqual(received, expectedDigest);
}

function owner(request: IncomingMessage): { tenantId: string; userId: string } | null {
  const tenantId = request.headers["x-lpbot-tenant-id"];
  const userId = request.headers["x-lpbot-user-id"];
  return typeof tenantId === "string" &&
    identityPattern.test(tenantId) &&
    typeof userId === "string" &&
    uuidPattern.test(userId)
    ? { tenantId, userId: userId.toLowerCase() }
    : null;
}

function reauthenticatedSessionId(request: IncomingMessage): string | null {
  const value = request.headers["x-lpbot-reauthenticated-session-id"];
  return typeof value === "string" && uuidPattern.test(value) ? value.toLowerCase() : null;
}

function dependencyList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === "string" && item.length > 0 && item.length <= 256 && !/\p{Cc}/u.test(item),
    ) &&
    new Set(value).size === value.length
  );
}

function deleteRequest(value: Record<string, unknown>): DeleteCustodyWalletRequest {
  const validBase =
    Number.isSafeInteger(value.expectedRevision) &&
    Number(value.expectedRevision) > 0 &&
    typeof value.previewToken === "string" &&
    /^[A-Za-z0-9_-]{43}$/u.test(value.previewToken);
  if (
    value.force === false &&
    validBase &&
    Object.keys(value).sort().join(",") === "expectedRevision,force,previewToken"
  ) {
    return {
      expectedRevision: Number(value.expectedRevision),
      force: false,
      previewToken: value.previewToken as string,
    };
  }
  const dependencies = value.dependencies;
  if (
    value.force !== true ||
    !validBase ||
    Object.keys(value).sort().join(",") !==
      "confirmationPhrase,dependencies,expectedRevision,force,previewToken" ||
    typeof value.confirmationPhrase !== "string" ||
    value.confirmationPhrase.length > 128 ||
    typeof dependencies !== "object" ||
    dependencies === null ||
    Array.isArray(dependencies)
  ) {
    throw new SignerError("INVALID_WALLET");
  }
  const lists = dependencies as Record<keyof WalletDeleteDependencies, unknown>;
  if (
    Object.keys(lists).sort().join(",") !== "assetIds,policyIds,positionIds,taskIds" ||
    !dependencyList(lists.assetIds) ||
    !dependencyList(lists.policyIds) ||
    !dependencyList(lists.positionIds) ||
    !dependencyList(lists.taskIds)
  ) {
    throw new SignerError("INVALID_WALLET");
  }
  return {
    confirmationPhrase: value.confirmationPhrase,
    dependencies: {
      assetIds: lists.assetIds,
      policyIds: lists.policyIds,
      positionIds: lists.positionIds,
      taskIds: lists.taskIds,
    },
    expectedRevision: Number(value.expectedRevision),
    force: true,
    previewToken: value.previewToken as string,
  };
}

function transferSigningRequest(value: unknown): {
  plan: WalletTransferPlan;
  planDigest: `sha256:${string}`;
} {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SignerError("TRANSFER_PLAN_REJECTED");
  }
  const request = value as Record<string, unknown>;
  if (
    Object.keys(request).sort().join(",") !== "plan,planDigest" ||
    typeof request.planDigest !== "string" ||
    !transferDigestPattern.test(request.planDigest) ||
    typeof request.plan !== "object" ||
    request.plan === null ||
    Array.isArray(request.plan)
  ) {
    throw new SignerError("TRANSFER_PLAN_REJECTED");
  }
  const plan = request.plan as Record<string, unknown>;
  if (
    Object.keys(plan).sort().join(",") !==
      [
        "amountBaseUnit",
        "asset",
        "chainId",
        "deadline",
        "feeLimit",
        "fencingToken",
        "nonce",
        "operationId",
        "policyDigest",
        "recipient",
        "transactionData",
        "transactionTarget",
        "transactionValueBaseUnit",
        "walletAddress",
        "walletId",
      ]
        .sort()
        .join(",") ||
    typeof plan.asset !== "object" ||
    plan.asset === null ||
    Array.isArray(plan.asset) ||
    typeof plan.feeLimit !== "object" ||
    plan.feeLimit === null ||
    Array.isArray(plan.feeLimit)
  ) {
    throw new SignerError("TRANSFER_PLAN_REJECTED");
  }
  const asset = plan.asset as Record<string, unknown>;
  const fee = plan.feeLimit as Record<string, unknown>;
  if (
    (asset.kind === "native" && Object.keys(asset).join(",") !== "kind") ||
    (asset.kind === "erc20" && Object.keys(asset).sort().join(",") !== "kind,tokenAddress") ||
    (asset.kind !== "native" && asset.kind !== "erc20") ||
    Object.keys(fee).sort().join(",") !==
      "feeCapBaseUnit,gasLimit,maxFeePerGasBaseUnit,maxPriorityFeePerGasBaseUnit"
  ) {
    throw new SignerError("TRANSFER_PLAN_REJECTED");
  }
  const candidate = plan as unknown as WalletTransferPlan;
  try {
    validateWalletTransferPlan(candidate);
  } catch (error) {
    throw new SignerError(
      error instanceof Error && error.message === "TRANSFER_PLAN_EXPIRED"
        ? "TRANSFER_PLAN_EXPIRED"
        : "TRANSFER_PLAN_REJECTED",
    );
  }
  return { plan: candidate, planDigest: request.planDigest as `sha256:${string}` };
}

function helperDeploymentSigningRequest(value: unknown): {
  plan: HelperDeploymentPlan;
  planDigest: `sha256:${string}`;
} {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SignerError("HELPER_PLAN_REJECTED");
  }
  const request = value as Record<string, unknown>;
  if (
    !exactKeys(request, ["plan", "planDigest"]) ||
    typeof request.planDigest !== "string" ||
    !digestPattern.test(request.planDigest) ||
    typeof request.plan !== "object" ||
    request.plan === null ||
    Array.isArray(request.plan)
  ) {
    throw new SignerError("HELPER_PLAN_REJECTED");
  }
  const plan = request.plan as Record<string, unknown>;
  if (
    !exactKeys(plan, [
      "chainId",
      "deadline",
      "deployment",
      "feeLimit",
      "fencingToken",
      "nonce",
      "operationId",
      "planDigest",
      "planVersion",
      "registry",
      "schemaVersion",
      "snapshotDigest",
      "transaction",
      "wallet",
    ])
  ) {
    throw new SignerError("HELPER_PLAN_REJECTED");
  }
  const nested = (key: string, keys: readonly string[]): Record<string, unknown> => {
    const candidate = plan[key];
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      Array.isArray(candidate) ||
      !exactKeys(candidate as Record<string, unknown>, keys)
    ) {
      throw new SignerError("HELPER_PLAN_REJECTED");
    }
    return candidate as Record<string, unknown>;
  };
  const deployment = nested("deployment", [
    "adapter",
    "constructorArgumentsHash",
    "creationCodeHash",
    "expectedAddress",
    "expectedRuntimeCodeHash",
    "helperVersion",
    "owner",
    "permit2",
    "tokenA",
    "tokenB",
  ]);
  nested("feeLimit", [
    "feeCapBaseUnit",
    "gasLimit",
    "maxFeePerGasBaseUnit",
    "maxPriorityFeePerGasBaseUnit",
  ]);
  nested("registry", ["blockNumber", "digest", "rollbackVersion", "version"]);
  const transaction = nested("transaction", ["data", "dataHash", "to", "valueBaseUnit"]);
  nested("wallet", ["address", "walletId"]);
  if (plan.chainId !== 31_337 || transaction.to !== null || transaction.valueBaseUnit !== "0") {
    throw new SignerError("HELPER_PLAN_REJECTED");
  }
  for (const key of ["tokenA", "tokenB"] as const) {
    const token = deployment[key];
    if (
      typeof token !== "object" ||
      token === null ||
      Array.isArray(token) ||
      !exactKeys(token as Record<string, unknown>, ["address", "runtimeCodeHash"])
    ) {
      throw new SignerError("HELPER_PLAN_REJECTED");
    }
  }
  return {
    plan: plan as unknown as HelperDeploymentPlan,
    planDigest: request.planDigest as `sha256:${string}`,
  };
}

function localSwapStepSigningRequest(value: unknown): {
  generation: number;
  maxFeePerGasBaseUnit: string;
  maxPriorityFeePerGasBaseUnit: string;
  plan: LocalSwapExecutionPlan;
  planDigest: `sha256:${string}`;
  stepId: string;
} {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SignerError("LOCAL_SWAP_PLAN_REJECTED");
  }
  const request = value as Record<string, unknown>;
  if (
    !exactKeys(request, [
      "generation",
      "maxFeePerGasBaseUnit",
      "maxPriorityFeePerGasBaseUnit",
      "plan",
      "planDigest",
      "stepId",
    ]) ||
    !Number.isSafeInteger(request.generation) ||
    Number(request.generation) < 0 ||
    typeof request.maxFeePerGasBaseUnit !== "string" ||
    !/^[1-9][0-9]*$/u.test(request.maxFeePerGasBaseUnit) ||
    typeof request.maxPriorityFeePerGasBaseUnit !== "string" ||
    !/^(?:0|[1-9][0-9]*)$/u.test(request.maxPriorityFeePerGasBaseUnit) ||
    typeof request.planDigest !== "string" ||
    !digestPattern.test(request.planDigest) ||
    typeof request.stepId !== "string" ||
    !uuidPattern.test(request.stepId) ||
    typeof request.plan !== "object" ||
    request.plan === null ||
    Array.isArray(request.plan)
  ) {
    throw new SignerError("LOCAL_SWAP_PLAN_REJECTED");
  }
  const plan = request.plan as Record<string, unknown>;
  if (
    !exactKeys(plan, [
      "authorization",
      "chainId",
      "deadline",
      "helper",
      "helperPlanDigest",
      "operationId",
      "planDigest",
      "planVersion",
      "quote",
      "registry",
      "schemaVersion",
      "serviceFeeBps",
      "steps",
      "wallet",
    ]) ||
    plan.chainId !== 31_337 ||
    plan.schemaVersion !== 2 ||
    plan.planVersion !== "p05-local-swap-plan-v2" ||
    plan.serviceFeeBps !== 0 ||
    !Array.isArray(plan.steps) ||
    plan.steps.length < 3 ||
    plan.steps.length > 4
  ) {
    throw new SignerError("LOCAL_SWAP_PLAN_REJECTED");
  }
  return {
    generation: Number(request.generation),
    maxFeePerGasBaseUnit: request.maxFeePerGasBaseUnit,
    maxPriorityFeePerGasBaseUnit: request.maxPriorityFeePerGasBaseUnit,
    plan: plan as unknown as LocalSwapExecutionPlan,
    planDigest: request.planDigest as `sha256:${string}`,
    stepId: request.stepId.toLowerCase(),
  };
}

function localSwapPermit2SigningRequest(value: unknown): LocalSwapPermit2SigningPayload {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SignerError("PERMIT2_AUTHORIZATION_REJECTED");
  }
  const request = value as Record<string, unknown>;
  if (
    !exactKeys(request, ["payload"]) ||
    typeof request.payload !== "object" ||
    request.payload === null ||
    Array.isArray(request.payload)
  ) {
    throw new SignerError("PERMIT2_AUTHORIZATION_REJECTED");
  }
  const payload = request.payload as Record<string, unknown>;
  if (
    !exactKeys(payload, [
      "amountBaseUnit",
      "domainSeparator",
      "expiration",
      "nonce",
      "permit2",
      "quoteDigest",
      "sigDeadline",
      "spender",
      "token",
      "walletId",
    ]) ||
    Object.values(payload).some((entry) => typeof entry !== "string")
  ) {
    throw new SignerError("PERMIT2_AUTHORIZATION_REJECTED");
  }
  return payload as unknown as LocalSwapPermit2SigningPayload;
}

function localPositionStepSigningRequest(value: unknown): {
  generation: number;
  maxFeePerGasBaseUnit: string;
  maxPriorityFeePerGasBaseUnit: string;
  plan: LocalPositionExecutionPlan;
  planDigest: `sha256:${string}`;
  stepId: string;
} {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SignerError("LOCAL_POSITION_PLAN_REJECTED");
  }
  const request = value as Record<string, unknown>;
  if (
    !exactKeys(request, [
      "generation",
      "maxFeePerGasBaseUnit",
      "maxPriorityFeePerGasBaseUnit",
      "plan",
      "planDigest",
      "stepId",
    ]) ||
    !Number.isSafeInteger(request.generation) ||
    Number(request.generation) < 0 ||
    typeof request.maxFeePerGasBaseUnit !== "string" ||
    !/^[1-9][0-9]*$/u.test(request.maxFeePerGasBaseUnit) ||
    typeof request.maxPriorityFeePerGasBaseUnit !== "string" ||
    !/^(?:0|[1-9][0-9]*)$/u.test(request.maxPriorityFeePerGasBaseUnit) ||
    typeof request.planDigest !== "string" ||
    !digestPattern.test(request.planDigest) ||
    typeof request.stepId !== "string" ||
    !uuidPattern.test(request.stepId) ||
    typeof request.plan !== "object" ||
    request.plan === null ||
    Array.isArray(request.plan)
  ) {
    throw new SignerError("LOCAL_POSITION_PLAN_REJECTED");
  }
  const plan = request.plan as Record<string, unknown>;
  if (
    !exactKeys(plan, [
      "accounting",
      "action",
      "chainId",
      "deadline",
      "manager",
      "operationId",
      "planDigest",
      "planVersion",
      "registry",
      "schemaVersion",
      "serviceFeeBps",
      "snapshot",
      "steps",
      "wallet",
    ]) ||
    plan.chainId !== 31_337 ||
    plan.schemaVersion !== 2 ||
    plan.planVersion !== "p05-local-position-plan-v2" ||
    plan.serviceFeeBps !== 0 ||
    !Array.isArray(plan.steps) ||
    plan.steps.length < 1 ||
    plan.steps.length > 3
  ) {
    throw new SignerError("LOCAL_POSITION_PLAN_REJECTED");
  }
  return {
    generation: Number(request.generation),
    maxFeePerGasBaseUnit: request.maxFeePerGasBaseUnit,
    maxPriorityFeePerGasBaseUnit: request.maxPriorityFeePerGasBaseUnit,
    plan: plan as unknown as LocalPositionExecutionPlan,
    planDigest: request.planDigest as `sha256:${string}`,
    stepId: request.stepId.toLowerCase(),
  };
}

function localHelperSweepSigningRequest(value: unknown): {
  generation: number;
  maxFeePerGasBaseUnit: string;
  maxPriorityFeePerGasBaseUnit: string;
  operationId: string;
  plan: LocalHelperSweepPlan;
  planDigest: `sha256:${string}`;
} {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SignerError("LOCAL_HELPER_SWEEP_PLAN_REJECTED");
  }
  const request = value as Record<string, unknown>;
  if (
    !exactKeys(request, [
      "generation",
      "maxFeePerGasBaseUnit",
      "maxPriorityFeePerGasBaseUnit",
      "operationId",
      "plan",
      "planDigest",
    ]) ||
    !Number.isSafeInteger(request.generation) ||
    Number(request.generation) < 0 ||
    typeof request.maxFeePerGasBaseUnit !== "string" ||
    !/^[1-9][0-9]*$/u.test(request.maxFeePerGasBaseUnit) ||
    typeof request.maxPriorityFeePerGasBaseUnit !== "string" ||
    !/^(?:0|[1-9][0-9]*)$/u.test(request.maxPriorityFeePerGasBaseUnit) ||
    typeof request.operationId !== "string" ||
    !uuidPattern.test(request.operationId) ||
    typeof request.planDigest !== "string" ||
    !digestPattern.test(request.planDigest) ||
    typeof request.plan !== "object" ||
    request.plan === null ||
    Array.isArray(request.plan)
  ) {
    throw new SignerError("LOCAL_HELPER_SWEEP_PLAN_REJECTED");
  }
  const plan = request.plan as Record<string, unknown>;
  const nested = (key: string, keys: readonly string[]): void => {
    const candidate = plan[key];
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      Array.isArray(candidate) ||
      !exactKeys(candidate as Record<string, unknown>, keys)
    ) {
      throw new SignerError("LOCAL_HELPER_SWEEP_PLAN_REJECTED");
    }
  };
  if (
    !exactKeys(plan, [
      "asset",
      "batchId",
      "chainId",
      "deadline",
      "feeLimit",
      "fencingToken",
      "helper",
      "nonce",
      "operationId",
      "planDigest",
      "planVersion",
      "recipient",
      "registry",
      "schemaVersion",
      "semanticDigest",
      "serviceFeeBps",
      "snapshot",
      "transaction",
      "wallet",
    ]) ||
    plan.chainId !== 31_337 ||
    plan.schemaVersion !== 2 ||
    plan.planVersion !== "p05-local-helper-sweep-plan-v2" ||
    plan.serviceFeeBps !== 0 ||
    plan.operationId !== request.operationId ||
    plan.planDigest !== request.planDigest
  ) {
    throw new SignerError("LOCAL_HELPER_SWEEP_PLAN_REJECTED");
  }
  nested("asset", ["amountBaseUnit", "assetId", "dustBaseUnit", "fixture", "kind", "tokenAddress"]);
  nested("feeLimit", [
    "feeCapBaseUnit",
    "gasLimit",
    "maxFeePerGasBaseUnit",
    "maxPriorityFeePerGasBaseUnit",
  ]);
  nested("helper", [
    "adapterAddress",
    "bindingId",
    "deploymentRegistryVersion",
    "helperAddress",
    "helperVersion",
    "ownerAddress",
    "permit2Address",
    "runtimeCodeHash",
    "verifiedBlockNumber",
    "walletId",
  ]);
  nested("registry", ["digest", "rollbackVersion", "version"]);
  nested("snapshot", ["blockHash", "blockNumber", "digest"]);
  nested("transaction", ["data", "dataDigest", "selector", "to", "valueBaseUnit"]);
  nested("wallet", ["address", "walletId"]);
  return {
    generation: Number(request.generation),
    maxFeePerGasBaseUnit: request.maxFeePerGasBaseUnit,
    maxPriorityFeePerGasBaseUnit: request.maxPriorityFeePerGasBaseUnit,
    operationId: request.operationId.toLowerCase(),
    plan: plan as unknown as LocalHelperSweepPlan,
    planDigest: request.planDigest as `sha256:${string}`,
  };
}

function localHelperUpgradeSigningRequest(value: unknown): {
  generation: number;
  maxFeePerGasBaseUnit: string;
  maxPriorityFeePerGasBaseUnit: string;
  operationId: string;
  plan: LocalHelperUpgradePlan;
  planDigest: `sha256:${string}`;
} {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SignerError("LOCAL_HELPER_UPGRADE_PLAN_REJECTED");
  }
  const request = value as Record<string, unknown>;
  if (
    !exactKeys(request, [
      "generation",
      "maxFeePerGasBaseUnit",
      "maxPriorityFeePerGasBaseUnit",
      "operationId",
      "plan",
      "planDigest",
    ]) ||
    !Number.isSafeInteger(request.generation) ||
    Number(request.generation) < 0 ||
    typeof request.maxFeePerGasBaseUnit !== "string" ||
    !/^[1-9][0-9]*$/u.test(request.maxFeePerGasBaseUnit) ||
    typeof request.maxPriorityFeePerGasBaseUnit !== "string" ||
    !/^(?:0|[1-9][0-9]*)$/u.test(request.maxPriorityFeePerGasBaseUnit) ||
    typeof request.operationId !== "string" ||
    !uuidPattern.test(request.operationId) ||
    typeof request.planDigest !== "string" ||
    !digestPattern.test(request.planDigest) ||
    typeof request.plan !== "object" ||
    request.plan === null ||
    Array.isArray(request.plan)
  ) {
    throw new SignerError("LOCAL_HELPER_UPGRADE_PLAN_REJECTED");
  }
  const plan = request.plan as Record<string, unknown>;
  const nested = (key: string, keys: readonly string[]): Record<string, unknown> => {
    const candidate = plan[key];
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      Array.isArray(candidate) ||
      !exactKeys(candidate as Record<string, unknown>, keys)
    ) {
      throw new SignerError("LOCAL_HELPER_UPGRADE_PLAN_REJECTED");
    }
    return candidate as Record<string, unknown>;
  };
  if (
    !exactKeys(plan, [
      "chainId",
      "deadline",
      "feeLimit",
      "fencingToken",
      "nonce",
      "operationId",
      "planDigest",
      "planVersion",
      "registry",
      "schemaVersion",
      "snapshot",
      "source",
      "target",
      "transaction",
      "wallet",
    ]) ||
    plan.chainId !== 31_337 ||
    plan.schemaVersion !== 3 ||
    plan.planVersion !== "p05-local-helper-upgrade-plan-v3" ||
    plan.operationId !== request.operationId ||
    plan.planDigest !== request.planDigest
  ) {
    throw new SignerError("LOCAL_HELPER_UPGRADE_PLAN_REJECTED");
  }
  nested("feeLimit", [
    "feeCapBaseUnit",
    "gasLimit",
    "maxFeePerGasBaseUnit",
    "maxPriorityFeePerGasBaseUnit",
  ]);
  nested("registry", ["digest", "rollbackVersion", "version"]);
  nested("snapshot", ["blockHash", "blockNumber", "digest"]);
  nested("source", ["bindingId", "helperAddress", "helperVersion", "runtimeCodeHash"]);
  const target = nested("target", [
    "abiHash",
    "adapter",
    "constructorArgumentsHash",
    "creationCodeHash",
    "expectedAddress",
    "expectedRuntimeCodeHash",
    "helperVersion",
    "owner",
    "permit2",
    "selectorSetHash",
    "tokenA",
    "tokenB",
  ]);
  const transaction = nested("transaction", ["data", "dataHash", "to", "valueBaseUnit"]);
  nested("wallet", ["address", "walletId"]);
  for (const key of ["tokenA", "tokenB"] as const) {
    const token = target[key];
    if (
      typeof token !== "object" ||
      token === null ||
      Array.isArray(token) ||
      !exactKeys(token as Record<string, unknown>, ["address", "runtimeCodeHash"])
    ) {
      throw new SignerError("LOCAL_HELPER_UPGRADE_PLAN_REJECTED");
    }
  }
  if (transaction.to !== null || transaction.valueBaseUnit !== "0") {
    throw new SignerError("LOCAL_HELPER_UPGRADE_PLAN_REJECTED");
  }
  return {
    generation: Number(request.generation),
    maxFeePerGasBaseUnit: request.maxFeePerGasBaseUnit,
    maxPriorityFeePerGasBaseUnit: request.maxPriorityFeePerGasBaseUnit,
    operationId: request.operationId.toLowerCase(),
    plan: plan as unknown as LocalHelperUpgradePlan,
    planDigest: request.planDigest as `sha256:${string}`,
  };
}

async function readBody(request: IncomingMessage, limit = bodyLimit): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of request) {
      const bytes = Buffer.isBuffer(chunk) ? Buffer.from(chunk) : Buffer.from(chunk as Uint8Array);
      size += bytes.length;
      if (size > limit) {
        bytes.fill(0);
        throw new SignerError("REQUEST_TOO_LARGE");
      }
      chunks.push(bytes);
    }
    return Buffer.concat(chunks);
  } finally {
    for (const chunk of chunks) chunk.fill(0);
  }
}

function send(response: ServerResponse, status: number, body: unknown): void {
  const serialized = JSON.stringify(body);
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(serialized),
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(serialized);
}

function failure(response: ServerResponse, error: unknown): void {
  const signerError = asSignerError(error);
  const status =
    signerError.code === "REQUEST_TOO_LARGE"
      ? 413
      : signerError.code === "CONFIRMATION_MISMATCH" ||
          signerError.code === "INVALID_MODE" ||
          signerError.code === "INVALID_PRIVATE_KEY" ||
          signerError.code === "INVALID_WALLET"
        ? 400
        : signerError.code === "INVALID_CREDENTIALS"
          ? 401
          : signerError.code === "LOCKED_OUT"
            ? 429
            : signerError.code === "DELETE_BLOCKED" ||
                signerError.code === "SECRET_VERSION_CONFLICT" ||
                signerError.code === "SECURITY_PASSWORD_VERSION_CONFLICT" ||
                signerError.code === "REVISION_CONFLICT" ||
                signerError.code === "PASSWORD_ALREADY_CONFIGURED" ||
                signerError.code === "PREVIEW_EXPIRED" ||
                signerError.code === "PREVIEW_CHANGED" ||
                signerError.code === "TRANSFER_PLAN_EXPIRED" ||
                signerError.code === "TRANSFER_PLAN_REJECTED" ||
                signerError.code === "HELPER_PLAN_EXPIRED" ||
                signerError.code === "HELPER_PLAN_REJECTED" ||
                signerError.code === "LOCAL_SWAP_PLAN_EXPIRED" ||
                signerError.code === "LOCAL_SWAP_PLAN_REJECTED" ||
                signerError.code === "LOCAL_POSITION_PLAN_EXPIRED" ||
                signerError.code === "LOCAL_POSITION_PLAN_REJECTED" ||
                signerError.code === "LOCAL_HELPER_SWEEP_PLAN_EXPIRED" ||
                signerError.code === "LOCAL_HELPER_SWEEP_PLAN_REJECTED" ||
                signerError.code === "LOCAL_HELPER_UPGRADE_PLAN_EXPIRED" ||
                signerError.code === "LOCAL_HELPER_UPGRADE_PLAN_REJECTED" ||
                signerError.code === "PERMIT2_AUTHORIZATION_REJECTED"
              ? 409
              : signerError.code === "WALLET_ADDRESS_EXISTS"
                ? 409
                : signerError.code === "WALLET_NOT_FOUND"
                  ? 404
                  : 503;
  send(response, status, {
    error: {
      code: signerError.code,
      retryable: signerError.retryable,
    },
    success: false,
  });
}

export function createSignerHttpServer(input: {
  apiToken: string;
  service: CustodySignerService;
}): Server {
  const expectedDigest = tokenDigest(input.apiToken);
  const activeImports = new Set<string>();
  const server = createServer(async (request, response) => {
    response.setHeader("Connection", "close");
    if (!authorized(request, expectedDigest)) {
      send(response, 401, { error: { code: "UNAUTHENTICATED", retryable: false }, success: false });
      return;
    }
    if (request.method === "GET" && request.url === "/health") {
      send(response, 200, {
        data: {
          capabilities: [
            "import",
            "generate",
            "seal",
            "open-verify",
            "password-reseal",
            "keystore-unlock",
            "keystore-auto-lock",
            ...(input.service.transferSigningConfigured()
              ? ["plan-bound-transaction-signing"]
              : []),
            ...(input.service.helperDeploymentSigningConfigured()
              ? ["plan-bound-helper-deployment-signing"]
              : []),
            ...(input.service.localSwapStepSigningConfigured()
              ? ["plan-bound-local-swap-step-signing"]
              : []),
            ...(input.service.localSwapPermit2SigningConfigured()
              ? ["plan-bound-local-permit2-signing"]
              : []),
            ...(input.service.localPositionStepSigningConfigured()
              ? ["plan-bound-local-position-step-signing"]
              : []),
            ...(input.service.localHelperSweepSigningConfigured()
              ? ["plan-bound-local-helper-sweep-signing"]
              : []),
            ...(input.service.localHelperUpgradeSigningConfigured()
              ? ["plan-bound-local-helper-upgrade-signing"]
              : []),
          ],
          ready: true,
        },
        success: true,
      });
      return;
    }
    const ownership = owner(request);
    if (!ownership) {
      send(response, 400, { error: { code: "INVALID_WALLET", retryable: false }, success: false });
      return;
    }
    let body: Buffer | null = null;
    let importAcquired = false;
    try {
      const sessionId = reauthenticatedSessionId(request);
      if (request.method === "POST" && request.url === "/v1/local-helper-upgrades/sign-and-deliver") {
        if (request.headers["content-type"]?.split(";", 1)[0] !== "application/json") {
          send(response, 415, {
            error: { code: "UNSUPPORTED_MEDIA_TYPE", retryable: false },
            success: false,
          });
          return;
        }
        body = await readBody(request, localHelperUpgradePlanBodyLimit);
        let parsed: unknown;
        try {
          parsed = JSON.parse(body.toString("utf8"));
        } catch {
          throw new SignerError("LOCAL_HELPER_UPGRADE_PLAN_REJECTED");
        }
        const signing = localHelperUpgradeSigningRequest(parsed);
        const signed = await input.service.signLocalHelperUpgrade({
          ...ownership,
          ...(sessionId ? { reauthenticatedSessionId: sessionId } : {}),
          ...signing,
        });
        send(response, 202, { data: signed, success: true });
        return;
      }
      if (request.method === "POST" && request.url === "/v1/local-helper-sweeps/sign-and-deliver") {
        if (request.headers["content-type"]?.split(";", 1)[0] !== "application/json") {
          send(response, 415, {
            error: { code: "UNSUPPORTED_MEDIA_TYPE", retryable: false },
            success: false,
          });
          return;
        }
        body = await readBody(request, localHelperSweepPlanBodyLimit);
        let parsed: unknown;
        try {
          parsed = JSON.parse(body.toString("utf8"));
        } catch {
          throw new SignerError("LOCAL_HELPER_SWEEP_PLAN_REJECTED");
        }
        const signing = localHelperSweepSigningRequest(parsed);
        const signed = await input.service.signLocalHelperSweep({
          ...ownership,
          ...(sessionId ? { reauthenticatedSessionId: sessionId } : {}),
          ...signing,
        });
        send(response, 202, { data: signed, success: true });
        return;
      }
      if (
        request.method === "POST" &&
        request.url === "/v1/local-position/steps/sign-and-deliver"
      ) {
        if (request.headers["content-type"]?.split(";", 1)[0] !== "application/json") {
          send(response, 415, {
            error: { code: "UNSUPPORTED_MEDIA_TYPE", retryable: false },
            success: false,
          });
          return;
        }
        body = await readBody(request, localPositionPlanBodyLimit);
        let parsed: unknown;
        try {
          parsed = JSON.parse(body.toString("utf8"));
        } catch {
          throw new SignerError("LOCAL_POSITION_PLAN_REJECTED");
        }
        const signing = localPositionStepSigningRequest(parsed);
        const signed = await input.service.signLocalPositionStep({
          ...ownership,
          ...(sessionId ? { reauthenticatedSessionId: sessionId } : {}),
          ...signing,
        });
        send(response, 202, { data: signed, success: true });
        return;
      }
      if (request.method === "POST" && request.url === "/v1/local-swap/steps/sign-and-deliver") {
        if (request.headers["content-type"]?.split(";", 1)[0] !== "application/json") {
          send(response, 415, {
            error: { code: "UNSUPPORTED_MEDIA_TYPE", retryable: false },
            success: false,
          });
          return;
        }
        body = await readBody(request, localSwapPlanBodyLimit);
        let parsed: unknown;
        try {
          parsed = JSON.parse(body.toString("utf8"));
        } catch {
          throw new SignerError("LOCAL_SWAP_PLAN_REJECTED");
        }
        const signing = localSwapStepSigningRequest(parsed);
        const signed = await input.service.signLocalSwapStep({
          ...ownership,
          ...(sessionId ? { reauthenticatedSessionId: sessionId } : {}),
          ...signing,
        });
        send(response, 202, { data: signed, success: true });
        return;
      }
      if (request.method === "POST" && request.url === "/v1/local-swap/permit2/sign") {
        if (request.headers["content-type"]?.split(";", 1)[0] !== "application/json") {
          send(response, 415, {
            error: { code: "UNSUPPORTED_MEDIA_TYPE", retryable: false },
            success: false,
          });
          return;
        }
        body = await readBody(request, localSwapPlanBodyLimit);
        let parsed: unknown;
        try {
          parsed = JSON.parse(body.toString("utf8"));
        } catch {
          throw new SignerError("PERMIT2_AUTHORIZATION_REJECTED");
        }
        const payload = localSwapPermit2SigningRequest(parsed);
        const signed = await input.service.signLocalSwapPermit2({
          ...ownership,
          ...(sessionId ? { reauthenticatedSessionId: sessionId } : {}),
          payload,
        });
        send(response, 200, { data: signed, success: true });
        return;
      }
      if (request.method === "POST" && request.url === "/v1/helper-deployments/sign-and-deliver") {
        if (request.headers["content-type"]?.split(";", 1)[0] !== "application/json") {
          send(response, 415, {
            error: { code: "UNSUPPORTED_MEDIA_TYPE", retryable: false },
            success: false,
          });
          return;
        }
        body = await readBody(request, helperDeploymentBodyLimit);
        let parsed: unknown;
        try {
          parsed = JSON.parse(body.toString("utf8"));
        } catch {
          throw new SignerError("HELPER_PLAN_REJECTED");
        }
        const deployment = helperDeploymentSigningRequest(parsed);
        const signed = await input.service.signHelperDeployment({
          ...ownership,
          ...(sessionId ? { reauthenticatedSessionId: sessionId } : {}),
          ...deployment,
        });
        send(response, 202, { data: signed, success: true });
        return;
      }
      if (request.method === "POST" && request.url === "/v1/wallet-transfers/sign-and-deliver") {
        if (request.headers["content-type"]?.split(";", 1)[0] !== "application/json") {
          send(response, 415, {
            error: { code: "UNSUPPORTED_MEDIA_TYPE", retryable: false },
            success: false,
          });
          return;
        }
        body = await readBody(request);
        let parsed: unknown;
        try {
          parsed = JSON.parse(body.toString("utf8"));
        } catch {
          throw new SignerError("TRANSFER_PLAN_REJECTED");
        }
        const transfer = transferSigningRequest(parsed);
        const signed = await input.service.signWalletTransfer({
          ...ownership,
          ...(sessionId ? { reauthenticatedSessionId: sessionId } : {}),
          ...transfer,
        });
        send(response, 202, { data: signed, success: true });
        return;
      }
      if (request.method === "GET" && request.url === "/v1/security-password/status") {
        const status = await input.service.securityPasswordStatus(ownership.userId);
        send(response, 200, { data: status, success: true });
        return;
      }
      if (request.method === "PUT" && request.url === "/v1/security-password") {
        if (
          request.headers["content-type"]?.split(";", 1)[0] !==
          "application/vnd.lpbot.security-password-secret+json"
        ) {
          send(response, 415, {
            error: { code: "UNSUPPORTED_MEDIA_TYPE", retryable: false },
            success: false,
          });
          return;
        }
        body = await readBody(request);
        const status = await input.service.putSecurityPassword({
          ingress: body,
          userId: ownership.userId,
        });
        send(response, 200, { data: status, success: true });
        return;
      }
      if (request.method === "POST" && request.url === "/v1/security-password/verify") {
        if (
          request.headers["content-type"]?.split(";", 1)[0] !==
          "application/vnd.lpbot.security-password-secret+json"
        ) {
          send(response, 415, {
            error: { code: "UNSUPPORTED_MEDIA_TYPE", retryable: false },
            success: false,
          });
          return;
        }
        body = await readBody(request);
        const verification = await input.service.verifySecurityPassword({
          ingress: body,
          userId: ownership.userId,
        });
        if (
          verification.verified !== true ||
          !Number.isSafeInteger(verification.version) ||
          verification.version < 1
        ) {
          throw new SignerError("SIGNER_UNAVAILABLE", true);
        }
        send(response, 200, {
          data: { verified: true, version: verification.version },
          success: true,
        });
        return;
      }
      if (request.method === "GET" && request.url === "/v1/keystore/status") {
        if (!sessionId) throw new SignerError("INVALID_WALLET");
        const status = await input.service.keystoreStatus(ownership.userId, sessionId);
        send(response, 200, { data: status, success: true });
        return;
      }
      if (request.method === "POST" && request.url === "/v1/keystore/lock") {
        const status = await input.service.lockKeystore(ownership.userId);
        send(response, 200, { data: status, success: true });
        return;
      }
      if (request.method === "GET" && request.url === "/v1/keystore/reset-preview") {
        const preview = await input.service.createKeystoreResetPreview(ownership.userId);
        send(response, 200, { data: preview, success: true });
        return;
      }
      const secretKeystorePath =
        request.url === "/v1/keystore/unlock" ||
        request.url === "/v1/keystore/password" ||
        request.url === "/v1/keystore/reset" ||
        /^\/v1\/wallets\/[0-9a-f-]+\/encryption-mode$/iu.test(request.url ?? "");
      if (
        secretKeystorePath &&
        (request.method === "POST" || request.method === "PUT") &&
        request.headers["content-type"]?.split(";", 1)[0] !==
          "application/vnd.lpbot.keystore-secret+json"
      ) {
        send(response, 415, {
          error: { code: "UNSUPPORTED_MEDIA_TYPE", retryable: false },
          success: false,
        });
        return;
      }
      if (request.method === "POST" && request.url === "/v1/keystore/unlock") {
        if (!sessionId) throw new SignerError("INVALID_WALLET");
        body = await readBody(request);
        const status = await input.service.unlockKeystore({
          ingress: body,
          reauthenticatedSessionId: sessionId,
          userId: ownership.userId,
        });
        send(response, 200, { data: status, success: true });
        return;
      }
      if (
        (request.method === "POST" || request.method === "PUT") &&
        request.url === "/v1/keystore/password"
      ) {
        body = await readBody(request);
        const status =
          request.method === "POST"
            ? await input.service.createKeystorePassword({
                ingress: body,
                userId: ownership.userId,
              })
            : await input.service.changeKeystorePassword({
                ingress: body,
                userId: ownership.userId,
              });
        send(response, 200, { data: status, success: true });
        return;
      }
      if (request.method === "PATCH" && request.url === "/v1/keystore/auto-lock") {
        if (!sessionId) throw new SignerError("INVALID_WALLET");
        body = await readBody(request);
        const parsed = JSON.parse(body.toString("utf8")) as unknown;
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          throw new SignerError("INVALID_AUTO_LOCK");
        }
        const value = parsed as Record<string, unknown>;
        const status = await input.service.updateKeystoreAutoLock({
          expectedVersion: Number(value.expectedVersion),
          minutes: Number(value.minutes),
          reauthenticatedSessionId: sessionId,
          userId: ownership.userId,
        });
        send(response, 200, { data: status, success: true });
        return;
      }
      if (request.method === "POST" && request.url === "/v1/keystore/reset") {
        body = await readBody(request);
        const status = await input.service.resetKeystore({
          ingress: body,
          userId: ownership.userId,
        });
        send(response, 202, { data: status, success: true });
        return;
      }
      const modeSwitch = /^\/v1\/wallets\/([0-9a-f-]+)\/encryption-mode$/iu.exec(request.url ?? "");
      if (request.method === "POST" && modeSwitch?.[1]) {
        body = await readBody(request);
        const wallet = await input.service.changeWalletEncryptionMode({
          ingress: body,
          ...ownership,
          walletId: modeSwitch[1].toLowerCase(),
        });
        send(response, 202, { data: wallet, success: true });
        return;
      }
      const deletePreview = /^\/v1\/wallets\/([0-9a-f-]+)\/delete-preview$/iu.exec(
        request.url ?? "",
      );
      if (request.method === "POST" && deletePreview?.[1]) {
        const preview = await input.service.createWalletDeletePreview(
          ownership.userId,
          deletePreview[1].toLowerCase(),
        );
        send(response, 201, { data: preview, success: true });
        return;
      }
      const walletLifecycle = /^\/v1\/wallets\/([0-9a-f-]+)$/iu.exec(request.url ?? "");
      if (walletLifecycle?.[1] && (request.method === "PATCH" || request.method === "DELETE")) {
        body = await readBody(request);
        let parsed: unknown;
        try {
          parsed = JSON.parse(body.toString("utf8"));
        } catch {
          throw new SignerError("INVALID_WALLET");
        }
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          throw new SignerError("INVALID_WALLET");
        }
        const value = parsed as Record<string, unknown>;
        if (request.method === "PATCH") {
          const updatedAt =
            typeof value.updatedAt === "string" ? new Date(value.updatedAt) : new Date(Number.NaN);
          if (
            Object.keys(value).sort().join(",") !== "expectedRevision,name,updatedAt" ||
            typeof value.name !== "string" ||
            !Number.isSafeInteger(value.expectedRevision) ||
            Number.isNaN(updatedAt.getTime()) ||
            updatedAt.toISOString() !== value.updatedAt
          ) {
            throw new SignerError("INVALID_WALLET");
          }
          const renamed = await input.service.renameWallet({
            expectedRevision: Number(value.expectedRevision),
            name: value.name,
            updatedAt,
            userId: ownership.userId,
            walletId: walletLifecycle[1].toLowerCase(),
          });
          send(response, 200, { data: renamed, success: true });
          return;
        }
        const deleted = await input.service.deleteWallet({
          ...deleteRequest(value),
          userId: ownership.userId,
          walletId: walletLifecycle[1].toLowerCase(),
        });
        send(response, 200, { data: deleted, success: true });
        return;
      }
      if (request.method === "POST" && request.url === "/v1/wallets/import") {
        if (
          request.headers["content-type"]?.split(";", 1)[0] !==
          "application/vnd.lpbot.wallet-secret+json"
        ) {
          send(response, 415, {
            error: { code: "UNSUPPORTED_MEDIA_TYPE", retryable: false },
            success: false,
          });
          return;
        }
        if (activeImports.has(ownership.userId)) {
          send(response, 409, {
            error: { code: "IMPORT_IN_PROGRESS", retryable: false },
            success: false,
          });
          return;
        }
        activeImports.add(ownership.userId);
        importAcquired = true;
        body = await readBody(request);
        const wallet = await input.service.importWallet({ ingress: body, ...ownership });
        send(response, 201, { data: wallet, success: true });
        return;
      }
      if (request.method === "POST" && request.url === "/v1/wallets/generate") {
        body = await readBody(request);
        const mediaType = request.headers["content-type"]?.split(";", 1)[0];
        if (mediaType === "application/vnd.lpbot.wallet-secret+json") {
          const wallet = await input.service.generateWallet({
            ingress: body,
            mode: "user-password",
            name: "secret-ingress",
            ...ownership,
          });
          send(response, 201, { data: wallet, success: true });
          return;
        }
        const parsed = JSON.parse(body.toString("utf8")) as unknown;
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          throw new SignerError("INVALID_WALLET");
        }
        const value = parsed as Record<string, unknown>;
        if (value.mode !== "server-kek" || typeof value.name !== "string") {
          throw new SignerError(value.mode === "server-kek" ? "INVALID_WALLET" : "INVALID_MODE");
        }
        const wallet = await input.service.generateWallet({
          mode: value.mode,
          name: value.name,
          ...ownership,
        });
        send(response, 201, { data: wallet, success: true });
        return;
      }
      const recovery = /^\/v1\/wallets\/([0-9a-f-]+)\/open-verify$/iu.exec(request.url ?? "");
      if (request.method === "POST" && recovery?.[1]) {
        const wallet = await input.service.recoverWallet({
          ...ownership,
          walletId: recovery[1].toLowerCase(),
        });
        send(response, 200, { data: wallet, success: true });
        return;
      }
      send(response, 404, { error: { code: "NOT_FOUND", retryable: false }, success: false });
    } catch (error) {
      failure(response, error);
    } finally {
      body?.fill(0);
      if (importAcquired) activeImports.delete(ownership.userId);
    }
  });
  server.headersTimeout = 5_000;
  server.requestTimeout = 10_000;
  server.keepAliveTimeout = 1_000;
  return server;
}
