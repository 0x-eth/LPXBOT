import { createHash } from "node:crypto";

export const LOCAL_HELPER_RESIDUAL_SNAPSHOT_VERSION =
  "p05-local-helper-residual-snapshot-v2" as const;
export const LOCAL_HELPER_SWEEP_PLAN_VERSION = "p05-local-helper-sweep-plan-v2" as const;

export type LocalHelperSweepAssetKind = "native" | "token";
export type LocalHelperSweepBindingState = "active" | "degraded";

export interface LocalHelperSweepFeeLimit {
  feeCapBaseUnit: string;
  gasLimit: string;
  maxFeePerGasBaseUnit: string;
  maxPriorityFeePerGasBaseUnit: string;
}

export interface LocalHelperSweepBinding {
  adapterAddress: `0x${string}`;
  bindingId: string;
  deploymentRegistryVersion: "p05-local-helper-deployment-v2";
  helperAddress: `0x${string}`;
  helperVersion: "WalletHelperV1";
  ownerAddress: `0x${string}`;
  permit2Address: `0x${string}`;
  runtimeCodeHash: `0x${string}`;
  state: LocalHelperSweepBindingState;
  verifiedBlockNumber: string;
}

export interface LocalHelperResidualBalance {
  amountBaseUnit: string;
  assetId: string;
  dustBaseUnit: string;
  fixture: "TestOnlyERC20" | "TestOnlyWBNB" | null;
  kind: LocalHelperSweepAssetKind;
  runtimeCodeHash: `0x${string}` | null;
  tokenAddress: `0x${string}` | null;
}

export interface LocalHelperResidualAllowance {
  amountBaseUnit: string;
  assetId: string;
  spenderAddress: `0x${string}`;
  spenderRole: "adapter" | "manager" | "permit2" | "router";
  tokenAddress: `0x${string}`;
}

export interface LocalHelperResidualNftCustody {
  assetId: string;
  managerAddress: `0x${string}`;
  tokenId: string;
}

export interface LocalHelperUnknownTokenResidual {
  amountBaseUnit: string;
  assetId: string;
  runtimeCodeHash: `0x${string}`;
  tokenAddress: `0x${string}`;
}

export interface LocalHelperResidualSnapshot {
  allowances: LocalHelperResidualAllowance[];
  balances: LocalHelperResidualBalance[];
  binding: LocalHelperSweepBinding;
  block: {
    hash: `0x${string}`;
    number: string;
    timestamp: string;
  };
  chainId: 31_337;
  coverage: {
    allowancesComplete: boolean;
    complete: boolean;
    helperIdentityComplete: boolean;
    nftCustodyComplete: boolean;
    tokenInventoryComplete: boolean;
  };
  degradationReasons: string[];
  expiresAt: string;
  identity: {
    bindingMatches: boolean;
    componentsMatch: boolean;
    observedOwner: `0x${string}` | null;
    observedRuntimeCodeHash: `0x${string}` | null;
    ownerMatches: boolean;
    registryMatches: boolean;
    runtimeMatches: boolean;
    tokensMatch: boolean;
  };
  manualRecoveryRequired: boolean;
  nftCustody: LocalHelperResidualNftCustody[];
  observedAt: string;
  registry: {
    digest: `sha256:${string}`;
    version: "p05-local-helper-sweep-v2";
  };
  schemaVersion: 2;
  snapshotDigest: `sha256:${string}`;
  snapshotVersion: typeof LOCAL_HELPER_RESIDUAL_SNAPSHOT_VERSION;
  unknownTokens: LocalHelperUnknownTokenResidual[];
  wallet: {
    address: `0x${string}`;
    walletId: string;
  };
}

export interface LocalHelperSweepAsset {
  amountBaseUnit: string;
  assetId: string;
  dustBaseUnit: string;
  fixture: "TestOnlyERC20" | "TestOnlyWBNB" | null;
  kind: LocalHelperSweepAssetKind;
  tokenAddress: `0x${string}` | null;
}

export interface LocalHelperSweepPlan {
  asset: LocalHelperSweepAsset;
  batchId: string;
  chainId: 31_337;
  deadline: string;
  feeLimit: LocalHelperSweepFeeLimit;
  fencingToken: string;
  helper: Omit<LocalHelperSweepBinding, "state">;
  nonce: string;
  operationId: string;
  planDigest: `sha256:${string}`;
  planVersion: typeof LOCAL_HELPER_SWEEP_PLAN_VERSION;
  recipient: `0x${string}`;
  registry: {
    digest: `sha256:${string}`;
    rollbackVersion: "p05-local-helper-sweep-disabled-v1";
    version: "p05-local-helper-sweep-v2";
  };
  schemaVersion: 2;
  semanticDigest: `sha256:${string}`;
  serviceFeeBps: 0;
  snapshot: {
    blockHash: `0x${string}`;
    blockNumber: string;
    digest: `sha256:${string}`;
  };
  transaction: {
    data: `0x${string}`;
    dataDigest: `sha256:${string}`;
    selector: "0x3609afa9" | "0x6971b189";
    to: `0x${string}`;
    valueBaseUnit: "0";
  };
  wallet: {
    address: `0x${string}`;
    walletId: string;
  };
}

export interface LocalHelperSweepSnapshotValidationContext {
  binding: LocalHelperSweepBinding;
  nativeDustBaseUnit: string;
  registryDigest: `sha256:${string}`;
  registryVersion: "p05-local-helper-sweep-v2";
  tokenPolicy: readonly {
    address: `0x${string}`;
    dustBaseUnit: string;
    fixture: "TestOnlyERC20" | "TestOnlyWBNB";
    runtimeCodeHash: `0x${string}`;
  }[];
  wallet: { address: `0x${string}`; walletId: string };
}

export interface LocalHelperSweepPlanValidationContext {
  currentBlockHash: `0x${string}`;
  currentBlockNumber: string;
  expectedAsset: LocalHelperSweepAsset;
  expectedBinding: LocalHelperSweepBinding;
  expectedWallet: { address: `0x${string}`; walletId: string };
  registryDigest: `sha256:${string}`;
}

export interface LocalHelperSweepReplacementCandidate {
  amountBaseUnit: string;
  assetId: string;
  dataDigest: `sha256:${string}`;
  fee: {
    maxFeePerGasBaseUnit: string;
    maxPriorityFeePerGasBaseUnit: string;
  };
  nonce: string;
  planDigest: `sha256:${string}`;
  recipient: `0x${string}`;
  semanticDigest: `sha256:${string}`;
  target: `0x${string}`;
}

const addressPattern = /^0x[0-9a-f]{40}$/u;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const hashPattern = /^0x[0-9a-f]{64}$/u;
const decimalPattern = /^(?:0|[1-9][0-9]*)$/u;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  }
  return value;
}

function digest(prefix: string, value: unknown): `sha256:${string}` {
  const hash = createHash("sha256")
    .update(prefix)
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
  return `sha256:${hash}`;
}

function decimal(value: string, code: string, positive = false): bigint {
  if (!decimalPattern.test(value) || value.length > 78) throw new RangeError(code);
  const parsed = BigInt(value);
  if (positive && parsed === 0n) throw new RangeError(code);
  return parsed;
}

function validTimestamp(value: string): boolean {
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

export function localHelperSweepDataDigest(value: `0x${string}`): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(Buffer.from(value.slice(2), "hex")).digest("hex")}`;
}

function uint256(value: bigint): string {
  return value.toString(16).padStart(64, "0");
}

function addressWord(value: `0x${string}`): string {
  return value.slice(2).padStart(64, "0");
}

function digestWord(value: `sha256:${string}`): string {
  return value.slice("sha256:".length);
}

function planIntent(plan: LocalHelperSweepPlan): unknown {
  return {
    asset: plan.asset,
    batchId: plan.batchId,
    chainId: plan.chainId,
    deadline: plan.deadline,
    feeLimit: plan.feeLimit,
    fencingToken: plan.fencingToken,
    helper: plan.helper,
    nonce: plan.nonce,
    operationId: plan.operationId,
    planVersion: plan.planVersion,
    recipient: plan.recipient,
    registry: plan.registry,
    schemaVersion: plan.schemaVersion,
    serviceFeeBps: plan.serviceFeeBps,
    snapshot: plan.snapshot,
    transaction: {
      selector: plan.transaction.selector,
      to: plan.transaction.to,
      valueBaseUnit: plan.transaction.valueBaseUnit,
    },
    wallet: plan.wallet,
  };
}

export function localHelperResidualSnapshotDigest(
  snapshot: LocalHelperResidualSnapshot,
): `sha256:${string}` {
  return digest("LPXBOT_LOCAL_HELPER_RESIDUAL_SNAPSHOT\0v2\0", {
    ...snapshot,
    snapshotDigest: undefined,
  });
}

export function localHelperSweepPlanDigest(plan: LocalHelperSweepPlan): `sha256:${string}` {
  return digest("LPXBOT_LOCAL_HELPER_SWEEP_PLAN\0v2\0", planIntent(plan));
}

export function localHelperSweepSemanticDigest(plan: LocalHelperSweepPlan): `sha256:${string}` {
  return digest("LPXBOT_LOCAL_HELPER_SWEEP_SEMANTIC\0v2\0", {
    amountBaseUnit: plan.asset.amountBaseUnit,
    assetId: plan.asset.assetId,
    dataDigest: plan.transaction.dataDigest,
    helperAddress: plan.helper.helperAddress,
    nonce: plan.nonce,
    operationId: plan.operationId,
    planDigest: plan.planDigest,
    recipient: plan.recipient,
    target: plan.transaction.to,
  });
}

export function localHelperSweepCalldata(
  planDigest: `sha256:${string}`,
  asset: LocalHelperSweepAsset,
): `0x${string}` {
  if (!digestPattern.test(planDigest)) throw new RangeError("LOCAL_HELPER_SWEEP_PLAN_INVALID");
  const amount = decimal(asset.amountBaseUnit, "LOCAL_HELPER_SWEEP_PLAN_INVALID", true);
  if (asset.kind === "native") {
    return `0x6971b189${digestWord(planDigest)}${uint256(amount)}`;
  }
  if (!asset.tokenAddress || !addressPattern.test(asset.tokenAddress)) {
    throw new RangeError("LOCAL_HELPER_SWEEP_PLAN_INVALID");
  }
  return `0x3609afa9${digestWord(planDigest)}${addressWord(asset.tokenAddress)}${uint256(amount)}`;
}

function expectedDegradationReasons(snapshot: LocalHelperResidualSnapshot): string[] {
  const reasons = new Set<string>();
  if (!snapshot.coverage.complete) reasons.add("coverage-incomplete");
  if (
    !snapshot.identity.bindingMatches ||
    !snapshot.identity.componentsMatch ||
    !snapshot.identity.ownerMatches ||
    !snapshot.identity.registryMatches ||
    !snapshot.identity.runtimeMatches ||
    !snapshot.identity.tokensMatch
  ) {
    reasons.add("identity-mismatch");
  }
  if (
    snapshot.balances.some(
      ({ amountBaseUnit, dustBaseUnit }) => BigInt(amountBaseUnit) > BigInt(dustBaseUnit),
    )
  ) {
    reasons.add("residual-above-dust");
  }
  if (snapshot.allowances.some(({ amountBaseUnit }) => BigInt(amountBaseUnit) > 0n)) {
    reasons.add("nonzero-allowance");
  }
  if (snapshot.nftCustody.length > 0) reasons.add("nft-custody");
  if (snapshot.unknownTokens.some(({ amountBaseUnit }) => BigInt(amountBaseUnit) > 0n)) {
    reasons.add("unknown-token");
  }
  return [...reasons].sort((left, right) => left.localeCompare(right));
}

export function validateLocalHelperResidualSnapshot(
  snapshot: LocalHelperResidualSnapshot,
  context: LocalHelperSweepSnapshotValidationContext,
  now: Date,
): LocalHelperResidualSnapshot {
  const invalid = () => {
    throw new RangeError("LOCAL_HELPER_RESIDUAL_SNAPSHOT_INVALID");
  };
  if (
    snapshot.chainId !== 31_337 ||
    snapshot.schemaVersion !== 2 ||
    snapshot.snapshotVersion !== LOCAL_HELPER_RESIDUAL_SNAPSHOT_VERSION ||
    snapshot.registry.version !== context.registryVersion ||
    snapshot.registry.digest !== context.registryDigest ||
    !digestPattern.test(snapshot.registry.digest) ||
    !hashPattern.test(snapshot.block.hash) ||
    !decimalPattern.test(snapshot.block.number) ||
    !validTimestamp(snapshot.block.timestamp) ||
    !validTimestamp(snapshot.observedAt) ||
    !validTimestamp(snapshot.expiresAt) ||
    Date.parse(snapshot.observedAt) > now.getTime() ||
    Date.parse(snapshot.expiresAt) <= now.getTime() ||
    Date.parse(snapshot.block.timestamp) > Date.parse(snapshot.observedAt) ||
    !same(snapshot.wallet, context.wallet) ||
    !same(snapshot.binding, context.binding) ||
    snapshot.wallet.address !== snapshot.binding.ownerAddress ||
    !uuidPattern.test(snapshot.wallet.walletId) ||
    !uuidPattern.test(snapshot.binding.bindingId) ||
    !addressPattern.test(snapshot.wallet.address) ||
    !addressPattern.test(snapshot.binding.helperAddress) ||
    !addressPattern.test(snapshot.binding.ownerAddress) ||
    !addressPattern.test(snapshot.binding.adapterAddress) ||
    !addressPattern.test(snapshot.binding.permit2Address) ||
    !hashPattern.test(snapshot.binding.runtimeCodeHash) ||
    (snapshot.identity.observedOwner !== null &&
      !addressPattern.test(snapshot.identity.observedOwner)) ||
    (snapshot.identity.observedRuntimeCodeHash !== null &&
      !hashPattern.test(snapshot.identity.observedRuntimeCodeHash)) ||
    snapshot.identity.ownerMatches !==
      (snapshot.identity.observedOwner === snapshot.binding.ownerAddress) ||
    snapshot.identity.runtimeMatches !==
      (snapshot.identity.observedRuntimeCodeHash === snapshot.binding.runtimeCodeHash) ||
    snapshot.balances.length !== context.tokenPolicy.length + 1 ||
    new Set(snapshot.balances.map(({ assetId }) => assetId)).size !== snapshot.balances.length ||
    new Set(snapshot.allowances.map(({ assetId }) => assetId)).size !== snapshot.allowances.length ||
    new Set(snapshot.nftCustody.map(({ assetId }) => assetId)).size !== snapshot.nftCustody.length ||
    new Set(snapshot.unknownTokens.map(({ assetId }) => assetId)).size !==
      snapshot.unknownTokens.length
  ) {
    invalid();
  }

  const native = snapshot.balances.find(({ kind }) => kind === "native");
  if (
    !native ||
    native.assetId !== "native:31337" ||
    native.tokenAddress !== null ||
    native.fixture !== null ||
    native.runtimeCodeHash !== null ||
    native.dustBaseUnit !== context.nativeDustBaseUnit
  ) {
    invalid();
  }
  for (const value of snapshot.balances) {
    try {
      decimal(value.amountBaseUnit, "LOCAL_HELPER_RESIDUAL_SNAPSHOT_INVALID");
      decimal(value.dustBaseUnit, "LOCAL_HELPER_RESIDUAL_SNAPSHOT_INVALID");
    } catch {
      invalid();
    }
    if (value.kind === "native") continue;
    const expected = context.tokenPolicy.find(({ address }) => address === value.tokenAddress);
    if (
      !expected ||
      value.assetId !== `token:${expected.address}` ||
      value.fixture !== expected.fixture ||
      value.runtimeCodeHash !== expected.runtimeCodeHash ||
      value.dustBaseUnit !== expected.dustBaseUnit
    ) {
      invalid();
    }
  }
  for (const value of snapshot.allowances) {
    if (
      !addressPattern.test(value.tokenAddress) ||
      !addressPattern.test(value.spenderAddress) ||
      value.assetId !== `allowance:${value.tokenAddress}:${value.spenderAddress}`
    ) {
      invalid();
    }
    try {
      decimal(value.amountBaseUnit, "LOCAL_HELPER_RESIDUAL_SNAPSHOT_INVALID");
    } catch {
      invalid();
    }
  }
  for (const value of snapshot.nftCustody) {
    if (
      !addressPattern.test(value.managerAddress) ||
      value.assetId !== `nft:${value.managerAddress}:${value.tokenId}`
    ) {
      invalid();
    }
    try {
      decimal(value.tokenId, "LOCAL_HELPER_RESIDUAL_SNAPSHOT_INVALID");
    } catch {
      invalid();
    }
  }
  for (const value of snapshot.unknownTokens) {
    if (
      !addressPattern.test(value.tokenAddress) ||
      !hashPattern.test(value.runtimeCodeHash) ||
      value.assetId !== `unknown-token:${value.tokenAddress}` ||
      context.tokenPolicy.some(({ address }) => address === value.tokenAddress)
    ) {
      invalid();
    }
    try {
      decimal(value.amountBaseUnit, "LOCAL_HELPER_RESIDUAL_SNAPSHOT_INVALID", true);
    } catch {
      invalid();
    }
  }
  const complete = Object.entries(snapshot.coverage)
    .filter(([key]) => key !== "complete")
    .every(([, value]) => value === true);
  const manualRecoveryRequired =
    snapshot.allowances.some(({ amountBaseUnit }) => BigInt(amountBaseUnit) > 0n) ||
    snapshot.nftCustody.length > 0 ||
    snapshot.unknownTokens.length > 0;
  const reasons = expectedDegradationReasons(snapshot);
  if (
    snapshot.coverage.complete !== complete ||
    snapshot.manualRecoveryRequired !== manualRecoveryRequired ||
    !same(snapshot.degradationReasons, reasons) ||
    snapshot.binding.state !== (reasons.length === 0 ? "active" : "degraded") ||
    snapshot.snapshotDigest !== localHelperResidualSnapshotDigest(snapshot)
  ) {
    invalid();
  }
  return snapshot;
}

export function validateLocalHelperSweepPlan(
  plan: LocalHelperSweepPlan,
  context: LocalHelperSweepPlanValidationContext,
  now: Date,
): LocalHelperSweepPlan {
  const invalid = () => {
    throw new RangeError("LOCAL_HELPER_SWEEP_PLAN_INVALID");
  };
  const expectedHelper: LocalHelperSweepPlan["helper"] = {
    adapterAddress: context.expectedBinding.adapterAddress,
    bindingId: context.expectedBinding.bindingId,
    deploymentRegistryVersion: context.expectedBinding.deploymentRegistryVersion,
    helperAddress: context.expectedBinding.helperAddress,
    helperVersion: context.expectedBinding.helperVersion,
    ownerAddress: context.expectedBinding.ownerAddress,
    permit2Address: context.expectedBinding.permit2Address,
    runtimeCodeHash: context.expectedBinding.runtimeCodeHash,
    verifiedBlockNumber: context.expectedBinding.verifiedBlockNumber,
  };
  if (
    plan.chainId !== 31_337 ||
    plan.schemaVersion !== 2 ||
    plan.planVersion !== LOCAL_HELPER_SWEEP_PLAN_VERSION ||
    plan.serviceFeeBps !== 0 ||
    plan.registry.version !== "p05-local-helper-sweep-v2" ||
    plan.registry.rollbackVersion !== "p05-local-helper-sweep-disabled-v1" ||
    plan.registry.digest !== context.registryDigest ||
    !uuidPattern.test(plan.batchId) ||
    !uuidPattern.test(plan.operationId) ||
    !same(plan.wallet, context.expectedWallet) ||
    !same(plan.helper, expectedHelper) ||
    plan.recipient !== plan.helper.ownerAddress ||
    plan.wallet.address !== plan.recipient ||
    plan.transaction.to !== plan.helper.helperAddress ||
    plan.transaction.valueBaseUnit !== "0" ||
    !same(plan.asset, context.expectedAsset) ||
    !digestPattern.test(plan.snapshot.digest) ||
    plan.snapshot.blockHash !== context.currentBlockHash ||
    plan.snapshot.blockNumber !== context.currentBlockNumber ||
    !validTimestamp(plan.deadline) ||
    Date.parse(plan.deadline) <= now.getTime() ||
    !hashPattern.test(plan.snapshot.blockHash)
  ) {
    invalid();
  }
  try {
    const amount = decimal(plan.asset.amountBaseUnit, "LOCAL_HELPER_SWEEP_PLAN_INVALID", true);
    const dust = decimal(plan.asset.dustBaseUnit, "LOCAL_HELPER_SWEEP_PLAN_INVALID");
    const gasLimit = decimal(plan.feeLimit.gasLimit, "LOCAL_HELPER_SWEEP_PLAN_INVALID", true);
    const maxFee = decimal(
      plan.feeLimit.maxFeePerGasBaseUnit,
      "LOCAL_HELPER_SWEEP_PLAN_INVALID",
      true,
    );
    const priority = decimal(
      plan.feeLimit.maxPriorityFeePerGasBaseUnit,
      "LOCAL_HELPER_SWEEP_PLAN_INVALID",
    );
    const cap = decimal(plan.feeLimit.feeCapBaseUnit, "LOCAL_HELPER_SWEEP_PLAN_INVALID", true);
    decimal(plan.nonce, "LOCAL_HELPER_SWEEP_PLAN_INVALID");
    decimal(plan.fencingToken, "LOCAL_HELPER_SWEEP_PLAN_INVALID", true);
    if (amount <= dust || priority > maxFee || gasLimit * maxFee !== cap) invalid();
  } catch {
    invalid();
  }
  if (
    (plan.asset.kind === "native" &&
      (plan.asset.assetId !== "native:31337" ||
        plan.asset.tokenAddress !== null ||
        plan.asset.fixture !== null ||
        plan.transaction.selector !== "0x6971b189")) ||
    (plan.asset.kind === "token" &&
      (!plan.asset.tokenAddress ||
        !addressPattern.test(plan.asset.tokenAddress) ||
        plan.asset.assetId !== `token:${plan.asset.tokenAddress}` ||
        plan.asset.fixture === null ||
        plan.transaction.selector !== "0x3609afa9"))
  ) {
    invalid();
  }
  if (plan.planDigest !== localHelperSweepPlanDigest(plan)) invalid();
  const calldata = localHelperSweepCalldata(plan.planDigest, plan.asset);
  if (
    plan.transaction.data !== calldata ||
    plan.transaction.dataDigest !== localHelperSweepDataDigest(calldata) ||
    plan.semanticDigest !== localHelperSweepSemanticDigest(plan)
  ) {
    invalid();
  }
  return plan;
}

export function validateLocalHelperSweepReplacement(
  plan: LocalHelperSweepPlan,
  previous: LocalHelperSweepReplacementCandidate,
  next: LocalHelperSweepReplacementCandidate,
): LocalHelperSweepReplacementCandidate {
  const immutable = [
    "amountBaseUnit",
    "assetId",
    "dataDigest",
    "nonce",
    "planDigest",
    "recipient",
    "semanticDigest",
    "target",
  ] as const;
  const previousMax = decimal(
    previous.fee.maxFeePerGasBaseUnit,
    "LOCAL_HELPER_SWEEP_REPLACEMENT_INVALID",
    true,
  );
  const previousPriority = decimal(
    previous.fee.maxPriorityFeePerGasBaseUnit,
    "LOCAL_HELPER_SWEEP_REPLACEMENT_INVALID",
  );
  const nextMax = decimal(
    next.fee.maxFeePerGasBaseUnit,
    "LOCAL_HELPER_SWEEP_REPLACEMENT_INVALID",
    true,
  );
  const nextPriority = decimal(
    next.fee.maxPriorityFeePerGasBaseUnit,
    "LOCAL_HELPER_SWEEP_REPLACEMENT_INVALID",
  );
  const gasLimit = decimal(plan.feeLimit.gasLimit, "LOCAL_HELPER_SWEEP_REPLACEMENT_INVALID", true);
  const feeCap = decimal(plan.feeLimit.feeCapBaseUnit, "LOCAL_HELPER_SWEEP_REPLACEMENT_INVALID", true);
  if (
    immutable.some((key) => previous[key] !== next[key]) ||
    previous.planDigest !== plan.planDigest ||
    previous.assetId !== plan.asset.assetId ||
    previous.amountBaseUnit !== plan.asset.amountBaseUnit ||
    previous.recipient !== plan.recipient ||
    previous.dataDigest !== plan.transaction.dataDigest ||
    previous.semanticDigest !== plan.semanticDigest ||
    previous.target !== plan.transaction.to ||
    previous.nonce !== plan.nonce ||
    nextMax < previousMax ||
    nextPriority < previousPriority ||
    (nextMax === previousMax && nextPriority === previousPriority) ||
    nextPriority > nextMax ||
    gasLimit * nextMax > feeCap
  ) {
    throw new RangeError("LOCAL_HELPER_SWEEP_REPLACEMENT_INVALID");
  }
  return next;
}
