import { createHash } from "node:crypto";

import type { LocalHelperResidualSnapshot, LocalHelperSweepBinding } from "./local-helper-sweep.js";

export const LOCAL_HELPER_UPGRADE_SNAPSHOT_VERSION =
  "p05-local-helper-upgrade-snapshot-v3" as const;
export const LOCAL_HELPER_UPGRADE_PLAN_VERSION = "p05-local-helper-upgrade-plan-v3" as const;

export const localHelperUpgradeCursors = Object.freeze([
  "preflight",
  "deploy-v2",
  "verify-v2",
  "sweep-v1",
  "final-rescan-v1",
  "atomic-binding-switch",
  "completed",
] as const);
export type LocalHelperUpgradeCursor = (typeof localHelperUpgradeCursors)[number];

export type LocalHelperUpgradeState =
  "queued" | "running" | "manual-recovery-required" | "failed" | "completed";

export type LocalHelperUpgradeBlocker =
  | "BINDING_DEGRADED"
  | "BINDING_IDENTITY_MISMATCH"
  | "LIVE_OPERATION"
  | "NONCE_CONFLICT"
  | "PROVIDER_DIVERGENCE"
  | "REGISTRY_MISMATCH"
  | "RESIDUAL_COVERAGE_INCOMPLETE"
  | "RESIDUAL_MANUAL_RECOVERY_REQUIRED"
  | "SOURCE_OWNER_MISMATCH"
  | "SOURCE_RUNTIME_MISMATCH"
  | "WALLET_MISMATCH";

export interface LocalHelperUpgradeFeeLimit {
  feeCapBaseUnit: string;
  gasLimit: string;
  maxFeePerGasBaseUnit: string;
  maxPriorityFeePerGasBaseUnit: string;
}

export interface LocalHelperUpgradeProviderView {
  blockHash: `0x${string}`;
  blockNumber: string;
  latestNonce: string;
  pendingNonce: string;
  providerId: string;
}

export interface LocalHelperUpgradeSnapshot {
  blockers: LocalHelperUpgradeBlocker[];
  chainId: 31_337;
  eligible: boolean;
  expiresAt: string;
  liveOperationIds: string[];
  nonceConflict: boolean;
  observedAt: string;
  providers: LocalHelperUpgradeProviderView[];
  registry: {
    digest: `sha256:${string}`;
    version: "p05-local-helper-upgrade-v3";
  };
  schemaVersion: 3;
  snapshotDigest: `sha256:${string}`;
  snapshotVersion: typeof LOCAL_HELPER_UPGRADE_SNAPSHOT_VERSION;
  sourceBinding: LocalHelperSweepBinding;
  sourceIdentity: {
    bindingMatches: boolean;
    observedOwner: `0x${string}` | null;
    observedRuntimeCodeHash: `0x${string}` | null;
    ownerMatches: boolean;
    registryMatches: boolean;
    runtimeMatches: boolean;
  };
  target: {
    expectedAddress: `0x${string}`;
    expectedRuntimeCodeHash: `0x${string}`;
    helperVersion: "WalletHelperV2";
  };
  v1Residual: {
    coverageComplete: boolean;
    manualRecoveryRequired: boolean;
    snapshotDigest: `sha256:${string}`;
  };
  wallet: {
    address: `0x${string}`;
    walletId: string;
  };
}

export interface LocalHelperUpgradePlan {
  chainId: 31_337;
  deadline: string;
  feeLimit: LocalHelperUpgradeFeeLimit;
  fencingToken: string;
  nonce: string;
  operationId: string;
  planDigest: `sha256:${string}`;
  planVersion: typeof LOCAL_HELPER_UPGRADE_PLAN_VERSION;
  registry: {
    digest: `sha256:${string}`;
    rollbackVersion: "p05-local-helper-upgrade-disabled-v1";
    version: "p05-local-helper-upgrade-v3";
  };
  schemaVersion: 3;
  snapshot: {
    blockHash: `0x${string}`;
    blockNumber: string;
    digest: `sha256:${string}`;
  };
  source: {
    bindingId: string;
    helperAddress: `0x${string}`;
    helperVersion: "WalletHelperV1";
    runtimeCodeHash: `0x${string}`;
  };
  target: {
    abiHash: `sha256:${string}`;
    adapter: `0x${string}`;
    constructorArgumentsHash: `sha256:${string}`;
    creationCodeHash: `0x${string}`;
    expectedAddress: `0x${string}`;
    expectedRuntimeCodeHash: `0x${string}`;
    helperVersion: "WalletHelperV2";
    owner: `0x${string}`;
    permit2: `0x${string}`;
    selectorSetHash: `sha256:${string}`;
    tokenA: { address: `0x${string}`; runtimeCodeHash: `0x${string}` };
    tokenB: { address: `0x${string}`; runtimeCodeHash: `0x${string}` };
  };
  transaction: {
    data: `0x${string}`;
    dataHash: `0x${string}`;
    to: null;
    valueBaseUnit: "0";
  };
  wallet: {
    address: `0x${string}`;
    walletId: string;
  };
}

export interface LocalHelperUpgradeSnapshotValidationContext {
  expectedSourceBinding: LocalHelperSweepBinding;
  registryDigest: `sha256:${string}`;
  target: {
    expectedAddress: `0x${string}`;
    expectedRuntimeCodeHash: `0x${string}`;
  };
  wallet: { address: `0x${string}`; walletId: string };
}

export interface LocalHelperUpgradePlanValidationContext {
  abiHash: `sha256:${string}`;
  adapter: `0x${string}`;
  constructorArgumentsHash: `sha256:${string}`;
  creationCodeHash: `0x${string}`;
  expectedAddress: `0x${string}`;
  expectedRuntimeCodeHash: `0x${string}`;
  initCode: `0x${string}`;
  initCodeHash: `0x${string}`;
  owner: `0x${string}`;
  permit2: `0x${string}`;
  registryDigest: `sha256:${string}`;
  selectorSetHash: `sha256:${string}`;
  sourceBinding: LocalHelperSweepBinding;
  tokenA: { address: `0x${string}`; runtimeCodeHash: `0x${string}` };
  tokenB: { address: `0x${string}`; runtimeCodeHash: `0x${string}` };
}

export interface WalletHelperV2Verification {
  abiHash: `sha256:${string}`;
  adapter: `0x${string}` | null;
  atomicLiquidityExecutionEnabled: boolean | null;
  blockHash: `0x${string}`;
  helperAddress: `0x${string}`;
  observedAtBlock: string;
  owner: `0x${string}` | null;
  permit2: `0x${string}` | null;
  runtimeCodeHash: `0x${string}` | null;
  selectorSetHash: `sha256:${string}`;
  tokenA: { address: `0x${string}` | null; runtimeCodeHash: `0x${string}` | null };
  tokenB: { address: `0x${string}` | null; runtimeCodeHash: `0x${string}` | null };
}

export interface WalletHelperV2VerificationContext {
  abiHash: `sha256:${string}`;
  adapter: `0x${string}`;
  expectedAddress: `0x${string}`;
  expectedRuntimeCodeHash: `0x${string}`;
  owner: `0x${string}`;
  permit2: `0x${string}`;
  selectorSetHash: `sha256:${string}`;
  tokenA: { address: `0x${string}`; runtimeCodeHash: `0x${string}` };
  tokenB: { address: `0x${string}`; runtimeCodeHash: `0x${string}` };
}

export interface LocalHelperUpgradeReplacementCandidate {
  abiHash: `sha256:${string}`;
  creationCodeHash: `0x${string}`;
  expectedAddress: `0x${string}`;
  fee: {
    maxFeePerGasBaseUnit: string;
    maxPriorityFeePerGasBaseUnit: string;
  };
  initCodeHash: `0x${string}`;
  nonce: string;
  owner: `0x${string}`;
  planDigest: `sha256:${string}`;
  registryDigest: `sha256:${string}`;
  targetVersion: "WalletHelperV2";
}

const addressPattern = /^0x[0-9a-f]{40}$/u;
const hashPattern = /^0x[0-9a-f]{64}$/u;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const decimalPattern = /^(?:0|[1-9][0-9]*)$/u;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const providerPattern = /^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$/u;

function canonical(value: unknown, excludedKey?: string): unknown {
  if (excludedKey === "planDigest" || excludedKey === "snapshotDigest") return undefined;
  if (Array.isArray(value)) return value.map((entry) => canonical(entry));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .flatMap(([key, entry]) => {
          const next = canonical(entry, key);
          return next === undefined ? [] : [[key, next]];
        }),
    );
  }
  return value;
}

function digest(prefix: string, value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256")
    .update(prefix, "utf8")
    .update(JSON.stringify(canonical(value)), "utf8")
    .digest("hex")}`;
}

function decimal(value: string, code: string, positive = false): bigint {
  if (!decimalPattern.test(value) || value.length > 78) throw new RangeError(code);
  const parsed = BigInt(value);
  if (positive && parsed === 0n) throw new RangeError(code);
  return parsed;
}

function timestamp(value: string): number {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new RangeError("LOCAL_HELPER_UPGRADE_TIMESTAMP_INVALID");
  }
  return parsed.getTime();
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

export function localHelperUpgradeSelectorSetHash(
  selectors: readonly { selector: `0x${string}`; signature: string }[],
): `sha256:${string}` {
  return digest("lpbot:p05:helper-v2-selectors:v3:", selectors);
}

export function localHelperUpgradeSnapshotDigest(
  snapshot: LocalHelperUpgradeSnapshot,
): `sha256:${string}` {
  return digest("lpbot:p05:helper-upgrade-snapshot:v3:", snapshot);
}

export function localHelperUpgradePlanDigest(plan: LocalHelperUpgradePlan): `sha256:${string}` {
  return digest("lpbot:p05:helper-upgrade-plan:v3:", plan);
}

function providerConsensus(providers: readonly LocalHelperUpgradeProviderView[]): boolean {
  if (providers.length < 1 || providers.length > 4) return false;
  const ids = new Set<string>();
  const observations = new Set<string>();
  for (const provider of providers) {
    if (
      !providerPattern.test(provider.providerId) ||
      ids.has(provider.providerId) ||
      !hashPattern.test(provider.blockHash)
    ) {
      return false;
    }
    ids.add(provider.providerId);
    try {
      const block = decimal(provider.blockNumber, "PROVIDER_DIVERGENCE");
      const latest = decimal(provider.latestNonce, "PROVIDER_DIVERGENCE");
      const pending = decimal(provider.pendingNonce, "PROVIDER_DIVERGENCE");
      if (pending < latest) return false;
      observations.add(`${block}:${provider.blockHash}:${latest}:${pending}`);
    } catch {
      return false;
    }
  }
  return observations.size === 1;
}

export function localHelperUpgradePreflightBlockers(
  snapshot: Omit<LocalHelperUpgradeSnapshot, "blockers" | "eligible" | "snapshotDigest">,
  context: LocalHelperUpgradeSnapshotValidationContext,
): LocalHelperUpgradeBlocker[] {
  const blockers = new Set<LocalHelperUpgradeBlocker>();
  if (
    snapshot.wallet.address !== context.wallet.address ||
    snapshot.wallet.walletId !== context.wallet.walletId ||
    snapshot.sourceBinding.walletId !== context.wallet.walletId ||
    snapshot.sourceBinding.ownerAddress !== context.wallet.address
  ) {
    blockers.add("WALLET_MISMATCH");
  }
  if (snapshot.sourceBinding.state !== "active") blockers.add("BINDING_DEGRADED");
  if (!same(snapshot.sourceBinding, context.expectedSourceBinding)) {
    blockers.add("BINDING_IDENTITY_MISMATCH");
  }
  if (
    !snapshot.sourceIdentity.ownerMatches ||
    snapshot.sourceIdentity.observedOwner !== context.wallet.address
  ) {
    blockers.add("SOURCE_OWNER_MISMATCH");
  }
  if (
    !snapshot.sourceIdentity.runtimeMatches ||
    snapshot.sourceIdentity.observedRuntimeCodeHash !==
      context.expectedSourceBinding.runtimeCodeHash
  ) {
    blockers.add("SOURCE_RUNTIME_MISMATCH");
  }
  if (
    snapshot.registry.digest !== context.registryDigest ||
    !snapshot.sourceIdentity.registryMatches
  ) {
    blockers.add("REGISTRY_MISMATCH");
  }
  if (!snapshot.sourceIdentity.bindingMatches) blockers.add("BINDING_IDENTITY_MISMATCH");
  if (snapshot.liveOperationIds.length > 0) blockers.add("LIVE_OPERATION");
  if (snapshot.nonceConflict) blockers.add("NONCE_CONFLICT");
  if (!providerConsensus(snapshot.providers)) blockers.add("PROVIDER_DIVERGENCE");
  if (!snapshot.v1Residual.coverageComplete) blockers.add("RESIDUAL_COVERAGE_INCOMPLETE");
  if (snapshot.v1Residual.manualRecoveryRequired) {
    blockers.add("RESIDUAL_MANUAL_RECOVERY_REQUIRED");
  }
  if (
    snapshot.target.expectedAddress !== context.target.expectedAddress ||
    snapshot.target.expectedRuntimeCodeHash !== context.target.expectedRuntimeCodeHash ||
    snapshot.target.helperVersion !== "WalletHelperV2"
  ) {
    blockers.add("REGISTRY_MISMATCH");
  }
  return [...blockers].sort();
}

export function validateLocalHelperUpgradeSnapshot(
  snapshot: LocalHelperUpgradeSnapshot,
  context: LocalHelperUpgradeSnapshotValidationContext,
  now: Date = new Date(),
): void {
  if (
    snapshot.schemaVersion !== 3 ||
    snapshot.snapshotVersion !== LOCAL_HELPER_UPGRADE_SNAPSHOT_VERSION ||
    snapshot.chainId !== 31_337 ||
    snapshot.registry.version !== "p05-local-helper-upgrade-v3" ||
    !digestPattern.test(snapshot.registry.digest) ||
    !digestPattern.test(snapshot.v1Residual.snapshotDigest) ||
    !uuidPattern.test(snapshot.wallet.walletId) ||
    !addressPattern.test(snapshot.wallet.address) ||
    !addressPattern.test(snapshot.target.expectedAddress) ||
    !hashPattern.test(snapshot.target.expectedRuntimeCodeHash)
  ) {
    throw new RangeError("LOCAL_HELPER_UPGRADE_SNAPSHOT_IDENTITY_INVALID");
  }
  const observedAt = timestamp(snapshot.observedAt);
  const expiresAt = timestamp(snapshot.expiresAt);
  if (
    expiresAt <= now.getTime() ||
    expiresAt <= observedAt ||
    expiresAt - observedAt > 15 * 60_000
  ) {
    throw new RangeError("LOCAL_HELPER_UPGRADE_SNAPSHOT_EXPIRED");
  }
  const { blockers: _blockers, eligible: _eligible, snapshotDigest: _digest, ...facts } = snapshot;
  const blockers = localHelperUpgradePreflightBlockers(facts, context);
  if (
    !same(snapshot.blockers, blockers) ||
    snapshot.eligible !== (blockers.length === 0) ||
    snapshot.snapshotDigest !== localHelperUpgradeSnapshotDigest(snapshot)
  ) {
    throw new RangeError("LOCAL_HELPER_UPGRADE_SNAPSHOT_MISMATCH");
  }
}

function sameToken(
  actual: LocalHelperUpgradePlan["target"]["tokenA"],
  expected: LocalHelperUpgradePlanValidationContext["tokenA"],
): boolean {
  return actual.address === expected.address && actual.runtimeCodeHash === expected.runtimeCodeHash;
}

export function validateLocalHelperUpgradePlan(
  plan: LocalHelperUpgradePlan,
  context: LocalHelperUpgradePlanValidationContext,
  now: Date = new Date(),
): void {
  if (
    plan.schemaVersion !== 3 ||
    plan.planVersion !== LOCAL_HELPER_UPGRADE_PLAN_VERSION ||
    plan.chainId !== 31_337 ||
    plan.registry.version !== "p05-local-helper-upgrade-v3" ||
    plan.registry.rollbackVersion !== "p05-local-helper-upgrade-disabled-v1" ||
    plan.registry.digest !== context.registryDigest ||
    !uuidPattern.test(plan.operationId) ||
    !uuidPattern.test(plan.wallet.walletId) ||
    !addressPattern.test(plan.wallet.address) ||
    plan.wallet.address !== context.owner ||
    plan.wallet.walletId !== context.sourceBinding.walletId
  ) {
    throw new RangeError("LOCAL_HELPER_UPGRADE_PLAN_IDENTITY_INVALID");
  }
  const deadline = timestamp(plan.deadline);
  if (deadline <= now.getTime() || deadline > now.getTime() + 15 * 60_000) {
    throw new RangeError("LOCAL_HELPER_UPGRADE_PLAN_EXPIRED");
  }
  decimal(plan.nonce, "LOCAL_HELPER_UPGRADE_NONCE_INVALID");
  decimal(plan.fencingToken, "LOCAL_HELPER_UPGRADE_FENCING_INVALID", true);
  decimal(plan.snapshot.blockNumber, "LOCAL_HELPER_UPGRADE_SNAPSHOT_INVALID");
  const gas = decimal(plan.feeLimit.gasLimit, "LOCAL_HELPER_UPGRADE_FEE_INVALID", true);
  const maxFee = decimal(
    plan.feeLimit.maxFeePerGasBaseUnit,
    "LOCAL_HELPER_UPGRADE_FEE_INVALID",
    true,
  );
  const priority = decimal(
    plan.feeLimit.maxPriorityFeePerGasBaseUnit,
    "LOCAL_HELPER_UPGRADE_FEE_INVALID",
  );
  if (
    priority > maxFee ||
    plan.feeLimit.feeCapBaseUnit !== (gas * maxFee).toString() ||
    plan.transaction.to !== null ||
    plan.transaction.valueBaseUnit !== "0" ||
    plan.transaction.data !== context.initCode ||
    plan.transaction.dataHash !== context.initCodeHash
  ) {
    throw new RangeError("LOCAL_HELPER_UPGRADE_TRANSACTION_INVALID");
  }
  if (
    plan.source.bindingId !== context.sourceBinding.bindingId ||
    plan.source.helperAddress !== context.sourceBinding.helperAddress ||
    plan.source.helperVersion !== "WalletHelperV1" ||
    plan.source.runtimeCodeHash !== context.sourceBinding.runtimeCodeHash
  ) {
    throw new RangeError("LOCAL_HELPER_UPGRADE_SOURCE_MISMATCH");
  }
  if (
    plan.target.helperVersion !== "WalletHelperV2" ||
    plan.target.owner !== context.owner ||
    plan.target.adapter !== context.adapter ||
    plan.target.permit2 !== context.permit2 ||
    plan.target.abiHash !== context.abiHash ||
    plan.target.selectorSetHash !== context.selectorSetHash ||
    plan.target.creationCodeHash !== context.creationCodeHash ||
    plan.target.constructorArgumentsHash !== context.constructorArgumentsHash ||
    plan.target.expectedAddress !== context.expectedAddress ||
    plan.target.expectedRuntimeCodeHash !== context.expectedRuntimeCodeHash ||
    !sameToken(plan.target.tokenA, context.tokenA) ||
    !sameToken(plan.target.tokenB, context.tokenB)
  ) {
    throw new RangeError("LOCAL_HELPER_UPGRADE_TARGET_MISMATCH");
  }
  if (
    !hashPattern.test(plan.snapshot.blockHash) ||
    !digestPattern.test(plan.snapshot.digest) ||
    plan.planDigest !== localHelperUpgradePlanDigest(plan)
  ) {
    throw new RangeError("LOCAL_HELPER_UPGRADE_PLAN_DIGEST_MISMATCH");
  }
}

export function assertWalletHelperV2Verification(
  actual: WalletHelperV2Verification,
  expected: WalletHelperV2VerificationContext,
): void {
  decimal(actual.observedAtBlock, "LOCAL_HELPER_UPGRADE_V2_VERIFICATION_INVALID");
  if (
    !hashPattern.test(actual.blockHash) ||
    actual.helperAddress !== expected.expectedAddress ||
    actual.runtimeCodeHash !== expected.expectedRuntimeCodeHash ||
    actual.owner !== expected.owner ||
    actual.adapter !== expected.adapter ||
    actual.permit2 !== expected.permit2 ||
    actual.abiHash !== expected.abiHash ||
    actual.selectorSetHash !== expected.selectorSetHash ||
    actual.atomicLiquidityExecutionEnabled !== false ||
    actual.tokenA.address !== expected.tokenA.address ||
    actual.tokenA.runtimeCodeHash !== expected.tokenA.runtimeCodeHash ||
    actual.tokenB.address !== expected.tokenB.address ||
    actual.tokenB.runtimeCodeHash !== expected.tokenB.runtimeCodeHash
  ) {
    throw new RangeError("LOCAL_HELPER_UPGRADE_V2_IDENTITY_MISMATCH");
  }
}

export function localHelperV1SupersedeDecision(snapshot: LocalHelperResidualSnapshot): {
  blockers: string[];
  eligible: boolean;
  manualRecoveryRequired: boolean;
} {
  const blockers = new Set<string>();
  if (!snapshot.coverage.complete) blockers.add("RESIDUAL_COVERAGE_INCOMPLETE");
  if (
    !snapshot.identity.bindingMatches ||
    !snapshot.identity.ownerMatches ||
    !snapshot.identity.runtimeMatches
  ) {
    blockers.add("V1_IDENTITY_MISMATCH");
  }
  if (snapshot.allowances.some(({ amountBaseUnit }) => BigInt(amountBaseUnit) !== 0n)) {
    blockers.add("NON_ZERO_ALLOWANCE");
  }
  if (snapshot.nftCustody.length > 0) blockers.add("NFT_CUSTODY");
  if (snapshot.unknownTokens.some(({ amountBaseUnit }) => BigInt(amountBaseUnit) !== 0n)) {
    blockers.add("UNKNOWN_TOKEN");
  }
  if (
    snapshot.balances.some(
      ({ amountBaseUnit, dustBaseUnit }) => BigInt(amountBaseUnit) > BigInt(dustBaseUnit),
    )
  ) {
    blockers.add("BALANCE_ABOVE_DUST");
  }
  const manualRecoveryRequired = ["NON_ZERO_ALLOWANCE", "NFT_CUSTODY", "UNKNOWN_TOKEN"].some(
    (code) => blockers.has(code),
  );
  if (snapshot.manualRecoveryRequired && !manualRecoveryRequired) {
    blockers.add("RESIDUAL_MANUAL_RECOVERY_REQUIRED");
  }
  return {
    blockers: [...blockers].sort(),
    eligible: blockers.size === 0,
    manualRecoveryRequired,
  };
}

export function nextLocalHelperUpgradeCursor(
  cursor: LocalHelperUpgradeCursor,
): LocalHelperUpgradeCursor {
  const index = localHelperUpgradeCursors.indexOf(cursor);
  if (index < 0 || cursor === "completed") return "completed";
  return localHelperUpgradeCursors[index + 1]!;
}

export function assertLocalHelperUpgradeCursorTransition(
  previous: LocalHelperUpgradeCursor,
  next: LocalHelperUpgradeCursor,
): void {
  if (nextLocalHelperUpgradeCursor(previous) !== next) {
    throw new RangeError("LOCAL_HELPER_UPGRADE_CURSOR_INVALID");
  }
}

export function localHelperUpgradeReplacementCandidate(
  plan: LocalHelperUpgradePlan,
  fee: LocalHelperUpgradeReplacementCandidate["fee"],
): LocalHelperUpgradeReplacementCandidate {
  return {
    abiHash: plan.target.abiHash,
    creationCodeHash: plan.target.creationCodeHash,
    expectedAddress: plan.target.expectedAddress,
    fee: { ...fee },
    initCodeHash: plan.transaction.dataHash,
    nonce: plan.nonce,
    owner: plan.target.owner,
    planDigest: plan.planDigest,
    registryDigest: plan.registry.digest,
    targetVersion: plan.target.helperVersion,
  };
}

export function validateLocalHelperUpgradeReplacement(
  plan: LocalHelperUpgradePlan,
  previous: LocalHelperUpgradeReplacementCandidate,
  next: LocalHelperUpgradeReplacementCandidate,
): void {
  const immutable = [
    "abiHash",
    "creationCodeHash",
    "expectedAddress",
    "initCodeHash",
    "nonce",
    "owner",
    "planDigest",
    "registryDigest",
    "targetVersion",
  ] as const;
  if (
    immutable.some((key) => previous[key] !== next[key]) ||
    next.planDigest !== plan.planDigest ||
    next.initCodeHash !== plan.transaction.dataHash ||
    next.nonce !== plan.nonce ||
    next.owner !== plan.target.owner ||
    next.targetVersion !== plan.target.helperVersion
  ) {
    throw new RangeError("LOCAL_HELPER_UPGRADE_REPLACEMENT_IDENTITY_CHANGED");
  }
  const previousMax = decimal(
    previous.fee.maxFeePerGasBaseUnit,
    "LOCAL_HELPER_UPGRADE_FEE_INVALID",
  );
  const previousPriority = decimal(
    previous.fee.maxPriorityFeePerGasBaseUnit,
    "LOCAL_HELPER_UPGRADE_FEE_INVALID",
  );
  const nextMax = decimal(next.fee.maxFeePerGasBaseUnit, "LOCAL_HELPER_UPGRADE_FEE_INVALID");
  const nextPriority = decimal(
    next.fee.maxPriorityFeePerGasBaseUnit,
    "LOCAL_HELPER_UPGRADE_FEE_INVALID",
  );
  if (
    nextMax < previousMax ||
    nextPriority < previousPriority ||
    (nextMax === previousMax && nextPriority === previousPriority) ||
    nextPriority > nextMax
  ) {
    throw new RangeError("LOCAL_HELPER_UPGRADE_REPLACEMENT_FEE_INVALID");
  }
}

export function compareLocalHelperVersions(
  left: "WalletHelperV1" | "WalletHelperV2",
  right: "WalletHelperV1" | "WalletHelperV2",
): -1 | 0 | 1 {
  const rank = { WalletHelperV1: 1, WalletHelperV2: 2 } as const;
  return rank[left] === rank[right] ? 0 : rank[left] < rank[right] ? -1 : 1;
}
