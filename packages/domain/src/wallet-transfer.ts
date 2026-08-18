import { createHash } from "node:crypto";

import type {
  EvmAddress,
  WalletTransferAddressClassification,
  WalletTransferAmount,
  WalletTransferAsset,
  WalletTransferFeeLimit,
  WalletTransferState,
} from "@lpbot/api-contract";

export const canonicalBaseUnitPattern = /^(?:0|[1-9][0-9]*)$/u;
export const transferDigestPattern = /^sha256:[0-9a-f]{64}$/u;
export const transferHashPattern = /^0x[0-9a-f]{64}$/u;
export const transferAddressPattern = /^0x[0-9a-f]{40}$/u;
export const erc20TransferSelector = "0xa9059cbb" as const;

export interface WalletTransferPlan {
  amountBaseUnit: string;
  asset: WalletTransferAsset;
  chainId: number;
  deadline: string;
  feeLimit: WalletTransferFeeLimit;
  fencingToken: string;
  nonce: string;
  operationId: string;
  policyDigest: `sha256:${string}`;
  recipient: EvmAddress;
  transactionData: `0x${string}`;
  transactionTarget: EvmAddress;
  transactionValueBaseUnit: string;
  walletAddress: EvmAddress;
  walletId: string;
}

export interface WalletTransferPreviewFacts {
  addressClassification: WalletTransferAddressClassification;
  amountBaseUnit: string;
  asset: WalletTransferAsset & { decimals: number; name: string; symbol: string };
  assetBalanceBaseUnit: string;
  blockNumber: string;
  chainId: number;
  expiresAt: string;
  feeLimit: WalletTransferFeeLimit;
  nativeBalanceBaseUnit: string;
  policyDigest: `sha256:${string}`;
  policyVersion: string;
  recipient: EvmAddress;
  registryVersion: string;
  walletAddress: EvmAddress;
  walletId: string;
}

export type TransferStateTransition = Readonly<{
  from: WalletTransferState;
  to: WalletTransferState;
}>;

const terminalOrEvidenceStates = new Set<WalletTransferState>([
  "confirmed",
  "failed",
  "dropped",
  "replaced",
]);

const allowedTransitions = new Set(
  [
    ["ready-for-approval", "queued"],
    ["ready-for-approval", "failed"],
    ["queued", "signed"],
    ["queued", "failed"],
    ["queued", "reconciling"],
    ["signed", "broadcast"],
    ["signed", "failed"],
    ["signed", "replaced"],
    ["signed", "reconciling"],
    ["broadcast", "pending"],
    ["broadcast", "confirmed"],
    ["broadcast", "failed"],
    ["broadcast", "dropped"],
    ["broadcast", "replaced"],
    ["broadcast", "reconciling"],
    ["pending", "confirmed"],
    ["pending", "failed"],
    ["pending", "dropped"],
    ["pending", "replaced"],
    ["pending", "reconciling"],
    ["confirmed", "pending"],
    ["confirmed", "reconciling"],
    ["failed", "pending"],
    ["failed", "reconciling"],
    ["dropped", "pending"],
    ["dropped", "reconciling"],
    ["replaced", "confirmed"],
    ["replaced", "reconciling"],
    ["reconciling", "pending"],
    ["reconciling", "confirmed"],
    ["reconciling", "failed"],
    ["reconciling", "dropped"],
    ["reconciling", "replaced"],
  ].map(([from, to]) => `${from}:${to}`),
);

function sha256(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function canonicalTimestamp(value: string, code: string): string {
  if (typeof value !== "string") throw new RangeError(code);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new RangeError(code);
  }
  return value;
}

function canonicalIdentifier(value: string, code: string): string {
  if (!/^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$/u.test(value)) {
    throw new RangeError(code);
  }
  return value;
}

export function canonicalBaseUnit(value: unknown, options: { positive?: boolean } = {}): string {
  if (
    typeof value !== "string" ||
    value.length > 160 ||
    !canonicalBaseUnitPattern.test(value) ||
    (options.positive === true && value === "0")
  ) {
    throw new RangeError("TRANSFER_AMOUNT_INVALID");
  }
  return value;
}

export function canonicalTransferAddress(value: unknown): EvmAddress {
  if (typeof value !== "string") throw new RangeError("TRANSFER_ADDRESS_INVALID");
  const address = value.toLowerCase();
  if (!transferAddressPattern.test(address)) throw new RangeError("TRANSFER_ADDRESS_INVALID");
  return address as EvmAddress;
}

export function resolveWalletTransferAmount(input: {
  amount: WalletTransferAmount;
  assetBalanceBaseUnit: string;
  assetKind: "erc20" | "native";
  feeCapBaseUnit: string;
  nativeBalanceBaseUnit: string;
}): string {
  const assetBalance = BigInt(canonicalBaseUnit(input.assetBalanceBaseUnit));
  const nativeBalance = BigInt(canonicalBaseUnit(input.nativeBalanceBaseUnit));
  const feeCap = BigInt(canonicalBaseUnit(input.feeCapBaseUnit));
  if (nativeBalance < feeCap) throw new RangeError("TRANSFER_GAS_INSUFFICIENT");
  const spendable = input.assetKind === "native" ? nativeBalance - feeCap : assetBalance;
  let amount: bigint;
  if (input.amount.kind === "exact") {
    amount = BigInt(canonicalBaseUnit(input.amount.amountBaseUnit, { positive: true }));
  } else {
    const numerator = input.amount.preset === "MAX" ? 100n : BigInt(input.amount.preset);
    if (numerator !== 25n && numerator !== 50n && numerator !== 75n && numerator !== 100n) {
      throw new RangeError("TRANSFER_AMOUNT_INVALID");
    }
    amount = (spendable * numerator) / 100n;
  }
  if (amount <= 0n) throw new RangeError("TRANSFER_AMOUNT_INVALID");
  if (amount > spendable) throw new RangeError("TRANSFER_BALANCE_INSUFFICIENT");
  return amount.toString();
}

export function walletTransferRequestHash(input: {
  amountBaseUnit: string;
  asset: WalletTransferAsset;
  chainId: number;
  previewDigest: string;
  recipient: EvmAddress;
  userId: string;
  walletId: string;
}): `sha256:${string}` {
  if (!Number.isSafeInteger(input.chainId) || input.chainId < 1) {
    throw new RangeError("TRANSFER_CHAIN_INVALID");
  }
  const token = input.asset.kind === "native" ? "native" : canonicalTransferAddress(input.asset.tokenAddress);
  const fields = [
    "transfer-request/v1",
    canonicalIdentifier(input.userId, "TRANSFER_OWNER_INVALID"),
    canonicalIdentifier(input.walletId, "TRANSFER_WALLET_INVALID"),
    String(input.chainId),
    input.asset.kind,
    token,
    canonicalTransferAddress(input.recipient),
    canonicalBaseUnit(input.amountBaseUnit, { positive: true }),
    transferDigestPattern.test(input.previewDigest) ? input.previewDigest : "",
  ];
  if (fields.at(-1) === "") throw new RangeError("TRANSFER_PREVIEW_INVALID");
  return sha256(fields.join("\n"));
}

export function walletTransferPreviewDigest(input: WalletTransferPreviewFacts): `sha256:${string}` {
  if (!Number.isSafeInteger(input.chainId) || input.chainId < 1) {
    throw new RangeError("TRANSFER_CHAIN_INVALID");
  }
  const assetToken =
    input.asset.kind === "native" ? "native" : canonicalTransferAddress(input.asset.tokenAddress);
  const fields = [
    "wallet-transfer-preview/v1",
    canonicalIdentifier(input.walletId, "TRANSFER_WALLET_INVALID"),
    canonicalTransferAddress(input.walletAddress),
    String(input.chainId),
    input.asset.kind,
    assetToken,
    String(input.asset.decimals),
    input.asset.name,
    input.asset.symbol,
    canonicalTransferAddress(input.recipient),
    input.addressClassification,
    canonicalBaseUnit(input.amountBaseUnit, { positive: true }),
    canonicalBaseUnit(input.assetBalanceBaseUnit),
    canonicalBaseUnit(input.nativeBalanceBaseUnit),
    canonicalBaseUnit(input.blockNumber),
    canonicalBaseUnit(input.feeLimit.gasLimit, { positive: true }),
    canonicalBaseUnit(input.feeLimit.maxFeePerGasBaseUnit, { positive: true }),
    canonicalBaseUnit(input.feeLimit.maxPriorityFeePerGasBaseUnit),
    canonicalBaseUnit(input.feeLimit.feeCapBaseUnit, { positive: true }),
    input.registryVersion,
    input.policyVersion,
    transferDigestPattern.test(input.policyDigest) ? input.policyDigest : "",
    canonicalTimestamp(input.expiresAt, "TRANSFER_PREVIEW_INVALID"),
  ];
  if (
    !Number.isInteger(input.asset.decimals) ||
    input.asset.decimals < 0 ||
    input.asset.decimals > 255 ||
    input.asset.name.length < 1 ||
    input.asset.name.length > 128 ||
    input.asset.symbol.length < 1 ||
    input.asset.symbol.length > 32 ||
    !["known-external", "new-external", "own-wallet"].includes(input.addressClassification) ||
    fields.some((field) => field.includes("\n") || field === "")
  ) {
    throw new RangeError("TRANSFER_PREVIEW_INVALID");
  }
  const calculatedFee =
    BigInt(input.feeLimit.gasLimit) * BigInt(input.feeLimit.maxFeePerGasBaseUnit);
  if (calculatedFee !== BigInt(input.feeLimit.feeCapBaseUnit)) {
    throw new RangeError("TRANSFER_FEE_INVALID");
  }
  return sha256(fields.join("\n"));
}

export function walletTransferPlanDigest(plan: WalletTransferPlan): `sha256:${string}` {
  validateWalletTransferPlan(plan, new Date(0));
  return sha256(
    [
      "wallet-transfer-plan/v1",
      plan.operationId,
      plan.walletId,
      plan.walletAddress,
      String(plan.chainId),
      plan.nonce,
      plan.fencingToken,
      plan.asset.kind,
      plan.asset.kind === "native" ? "native" : plan.asset.tokenAddress,
      plan.recipient,
      plan.amountBaseUnit,
      plan.transactionTarget,
      plan.transactionValueBaseUnit,
      plan.transactionData,
      plan.feeLimit.gasLimit,
      plan.feeLimit.maxFeePerGasBaseUnit,
      plan.feeLimit.maxPriorityFeePerGasBaseUnit,
      plan.feeLimit.feeCapBaseUnit,
      plan.deadline,
      plan.policyDigest,
    ].join("\n"),
  );
}

export function validateWalletTransferPlan(plan: WalletTransferPlan, at = new Date()): void {
  canonicalIdentifier(plan.operationId, "TRANSFER_PLAN_INVALID");
  canonicalIdentifier(plan.walletId, "TRANSFER_PLAN_INVALID");
  canonicalTransferAddress(plan.walletAddress);
  canonicalTransferAddress(plan.recipient);
  canonicalTransferAddress(plan.transactionTarget);
  canonicalBaseUnit(plan.nonce);
  canonicalBaseUnit(plan.fencingToken, { positive: true });
  canonicalBaseUnit(plan.amountBaseUnit, { positive: true });
  canonicalBaseUnit(plan.transactionValueBaseUnit);
  canonicalBaseUnit(plan.feeLimit.gasLimit, { positive: true });
  canonicalBaseUnit(plan.feeLimit.maxFeePerGasBaseUnit, { positive: true });
  canonicalBaseUnit(plan.feeLimit.maxPriorityFeePerGasBaseUnit);
  canonicalBaseUnit(plan.feeLimit.feeCapBaseUnit, { positive: true });
  if (
    !Number.isSafeInteger(plan.chainId) ||
    plan.chainId < 1 ||
    !transferDigestPattern.test(plan.policyDigest) ||
    !/^0x(?:[0-9a-f]{2})*$/u.test(plan.transactionData) ||
    BigInt(plan.feeLimit.maxPriorityFeePerGasBaseUnit) >
      BigInt(plan.feeLimit.maxFeePerGasBaseUnit) ||
    BigInt(plan.feeLimit.gasLimit) * BigInt(plan.feeLimit.maxFeePerGasBaseUnit) !==
      BigInt(plan.feeLimit.feeCapBaseUnit)
  ) {
    throw new RangeError("TRANSFER_PLAN_INVALID");
  }
  const deadline = new Date(canonicalTimestamp(plan.deadline, "TRANSFER_PLAN_INVALID"));
  if (deadline.getTime() <= at.getTime()) throw new RangeError("TRANSFER_PLAN_EXPIRED");
  if (plan.recipient === plan.walletAddress) throw new RangeError("TRANSFER_SELF_FORBIDDEN");
  if (plan.asset.kind === "native") {
    if (
      plan.transactionTarget !== plan.recipient ||
      plan.transactionValueBaseUnit !== plan.amountBaseUnit ||
      plan.transactionData !== "0x"
    ) {
      throw new RangeError("TRANSFER_PLAN_INVALID");
    }
    return;
  }
  const token = canonicalTransferAddress(plan.asset.tokenAddress);
  if (
    plan.transactionTarget !== token ||
    plan.transactionValueBaseUnit !== "0" ||
    plan.transactionData.length !== 138 ||
    !plan.transactionData.startsWith(erc20TransferSelector)
  ) {
    throw new RangeError("TRANSFER_CALLDATA_FORBIDDEN");
  }
  const encodedRecipient = `0x${plan.transactionData.slice(34, 74)}`;
  const encodedAmount = BigInt(`0x${plan.transactionData.slice(74)}`).toString();
  if (encodedRecipient !== plan.recipient || encodedAmount !== plan.amountBaseUnit) {
    throw new RangeError("TRANSFER_CALLDATA_FORBIDDEN");
  }
}

export function canTransitionWalletTransfer(from: WalletTransferState, to: WalletTransferState) {
  return from === to || allowedTransitions.has(`${from}:${to}`);
}

export function assertWalletTransferTransition(transition: TransferStateTransition): void {
  if (!canTransitionWalletTransfer(transition.from, transition.to)) {
    throw new RangeError("TRANSFER_STATE_TRANSITION_INVALID");
  }
}

export function walletTransferStateIsTerminal(state: WalletTransferState): boolean {
  return terminalOrEvidenceStates.has(state);
}

export interface WalletTransferReceiptEvidence {
  balanceReconciled: boolean;
  blockCanonical: boolean;
  from: EvmAddress;
  nonce: string;
  receiptStatus: "reverted" | "success";
  tokenTransferLogReconciled: boolean;
  transactionHash: `0x${string}`;
  transactionTarget: EvmAddress;
}

export function reconcileWalletTransferReceipt(input: {
  assetKind: "erc20" | "native";
  expectedHash: `0x${string}`;
  plan: WalletTransferPlan;
  receipt: WalletTransferReceiptEvidence;
}): { reason: string | null; state: "confirmed" | "failed" | "reconciling" } {
  const receipt = input.receipt;
  if (
    !transferHashPattern.test(receipt.transactionHash) ||
    receipt.transactionHash !== input.expectedHash ||
    canonicalTransferAddress(receipt.from) !== input.plan.walletAddress ||
    canonicalBaseUnit(receipt.nonce) !== input.plan.nonce ||
    canonicalTransferAddress(receipt.transactionTarget) !== input.plan.transactionTarget
  ) {
    return { reason: "RECEIPT_IDENTITY_MISMATCH", state: "reconciling" };
  }
  if (!receipt.blockCanonical) return { reason: "RECEIPT_NOT_CANONICAL", state: "reconciling" };
  if (receipt.receiptStatus === "reverted") return { reason: null, state: "failed" };
  if (!receipt.balanceReconciled) {
    return { reason: "BALANCE_RECONCILIATION_PENDING", state: "reconciling" };
  }
  if (input.assetKind === "erc20" && !receipt.tokenTransferLogReconciled) {
    return { reason: "TRANSFER_LOG_RECONCILIATION_PENDING", state: "reconciling" };
  }
  return { reason: null, state: "confirmed" };
}
