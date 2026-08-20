import { randomBytes as systemRandomBytes } from "node:crypto";

import type { WalletEncryptionMode } from "@lpbot/api-contract";
import {
  buildWalletHelperV1DeploymentMaterial,
  buildWalletHelperV2DeploymentMaterial,
  helperDeploymentComponent,
  P05_HELPER_DEPLOYMENT_REGISTRY,
  P05_LOCAL_HELPER_UPGRADE_REGISTRY,
  P05_LOCAL_HELPER_SWEEP_REGISTRY,
  P05_LOCAL_POSITION_EXECUTION_REGISTRY,
} from "@lpbot/chain-registry";
import {
  helperDeploymentPlanDigest,
  validateHelperDeploymentPlan,
  type HelperDeploymentPlan,
} from "@lpbot/domain/helper-deployment";
import {
  localHelperUpgradePlanDigest,
  localHelperUpgradeSelectorSetHash,
  validateLocalHelperUpgradePlan,
  type LocalHelperUpgradePlan,
} from "@lpbot/domain/local-helper-upgrade";
import {
  localHelperSweepCalldata,
  localHelperSweepDataDigest,
  localHelperSweepPlanDigest,
  localHelperSweepSemanticDigest,
  validateLocalHelperSweepPlan,
  type LocalHelperSweepPlan,
} from "@lpbot/domain/local-helper-sweep";
import {
  localSwapExecutionPlanDigest,
  localSwapPermit2AuthorizationDigest,
  type LocalSwapExecutionPlan,
  type LocalSwapPermit2SigningPayload,
} from "@lpbot/domain/local-swap-execution";
import {
  localPositionExecutionPlanDigest,
  type LocalPositionExecutionPlan,
} from "@lpbot/domain/local-position-execution";
import {
  validateWalletTransferPlan,
  walletTransferPlanDigest,
  type WalletTransferPlan,
} from "@lpbot/domain/wallet-transfer";
import { getContractAddress, keccak256, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import type {
  CustodyEnvelope,
  RawTransactionDelivery,
  StoredCustodyWallet,
  WalletTransferSigningResult,
  HelperDeploymentSigningResult,
  LocalSwapPermit2SigningResult,
  LocalSwapStepSigningResult,
  LocalPositionStepSigningResult,
  LocalHelperSweepSigningResult,
  LocalHelperUpgradeSigningResult,
} from "./custody-types.js";
import type { KmsClient } from "./kms.js";
import {
  buildPasswordDekWrapAad,
  openPasswordDekWrap,
  sealPasswordDekWrap,
} from "./password-crypto.js";
import { SignerError } from "./signer-error.js";
import {
  buildWalletAad,
  deriveEvmAddress,
  generatePrivateKey,
  openEnvelope,
  parsePrivateKey,
  privateKeyInputName,
  sealEnvelope,
} from "./wallet-crypto.js";

export const signerCapabilities = [
  "import",
  "generate",
  "seal",
  "open-verify",
  "password-reseal",
  "plan-bound-transaction-signing",
  "plan-bound-helper-deployment-signing",
  "plan-bound-local-swap-step-signing",
  "plan-bound-local-permit2-signing",
  "plan-bound-local-position-step-signing",
  "plan-bound-local-helper-sweep-signing",
  "plan-bound-local-helper-upgrade-signing",
] as const;

export interface SealedWalletDraft {
  address: `0x${string}`;
  addressLower: `0x${string}`;
  envelope: CustodyEnvelope;
  mode: WalletEncryptionMode;
  name: string;
}

interface SecretImportBody {
  mode: WalletEncryptionMode;
  name: string;
  privateKey: string;
}

function bufferView(bytes: Uint8Array): Buffer {
  return Buffer.from(bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.byteLength);
}

function parseIngress(bytes: Uint8Array): SecretImportBody {
  try {
    const parsed = JSON.parse(bufferView(bytes).toString("utf8")) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new SignerError("INVALID_PRIVATE_KEY");
    }
    const record = parsed as Record<string, unknown>;
    if (record.mode !== "server-kek" && record.mode !== "user-password") {
      throw new SignerError("INVALID_MODE");
    }
    const allowed =
      record.mode === "user-password"
        ? ["mode", "name", "password", "privateKey"]
        : ["mode", "name", "privateKey"];
    if (
      Object.keys(record).some((key) => !allowed.includes(key)) ||
      Object.keys(record).length !== allowed.length ||
      !Object.hasOwn(record, "privateKey") ||
      (record.mode === "user-password" && typeof record.password !== "string")
    ) {
      throw new SignerError("INVALID_PRIVATE_KEY");
    }
    record.password = "";
    return {
      mode: record.mode,
      name: privateKeyInputName(record.name),
      privateKey: typeof record.privateKey === "string" ? record.privateKey : "",
    };
  } catch (error) {
    if (error instanceof SignerError) throw error;
    throw new SignerError("INVALID_PRIVATE_KEY");
  }
}

type ZeroizeLabel = "dek" | "ingress" | "private-key";

export class IsolatedWalletSigner {
  readonly #kms: KmsClient;
  readonly #onZeroize: (label: ZeroizeLabel, bytes: Uint8Array) => void;
  readonly #privateKeyRandomBytes: (length: number) => Uint8Array;
  readonly #secretRandomBytes: (length: number) => Uint8Array;

  constructor(input: {
    kms: KmsClient;
    onZeroize?: (label: ZeroizeLabel, bytes: Uint8Array) => void;
    randomBytes?: (length: number) => Uint8Array;
    secretRandomBytes?: (length: number) => Uint8Array;
  }) {
    this.#kms = input.kms;
    this.#onZeroize = input.onZeroize ?? (() => undefined);
    this.#privateKeyRandomBytes = input.randomBytes ?? systemRandomBytes;
    this.#secretRandomBytes = input.secretRandomBytes ?? systemRandomBytes;
  }

  async importAndSeal(input: {
    envelopeVersion: number;
    ingress: Uint8Array;
    passwordKek?: Uint8Array | undefined;
    secretVersion?: number | undefined;
    tenantId: string;
    userId: string;
    walletId: string;
  }): Promise<SealedWalletDraft> {
    let privateKey: Buffer | null = null;
    try {
      const body = parseIngress(input.ingress);
      privateKey = parsePrivateKey(body.privateKey);
      body.privateKey = "";
      return await this.seal({ ...input, mode: body.mode, name: body.name, privateKey });
    } finally {
      if (privateKey) this.#zeroize("private-key", privateKey);
      this.#zeroize("ingress", input.ingress);
    }
  }

  async generateAndSeal(input: {
    envelopeVersion: number;
    mode: WalletEncryptionMode;
    name: string;
    passwordKek?: Uint8Array | undefined;
    secretVersion?: number | undefined;
    tenantId: string;
    userId: string;
    walletId: string;
  }): Promise<SealedWalletDraft> {
    if (input.mode !== "server-kek" && input.mode !== "user-password") {
      throw new SignerError("INVALID_MODE");
    }
    const privateKey = generatePrivateKey(this.#privateKeyRandomBytes);
    try {
      return await this.seal({ ...input, name: privateKeyInputName(input.name), privateKey });
    } finally {
      this.#zeroize("private-key", privateKey);
    }
  }

  async seal(input: {
    envelopeVersion: number;
    mode: WalletEncryptionMode;
    name: string;
    passwordKek?: Uint8Array | undefined;
    privateKey: Uint8Array;
    secretVersion?: number | undefined;
    tenantId: string;
    userId: string;
    walletId: string;
  }): Promise<SealedWalletDraft> {
    const address = deriveEvmAddress(input.privateKey);
    const dek = bufferView(this.#secretRandomBytes(32));
    if (dek.length !== 32) {
      dek.fill(0);
      throw new SignerError("SIGNER_UNAVAILABLE", true);
    }
    try {
      const envelope = await this.#sealMaterial({
        addressLower: address.lowercaseAddress,
        dek,
        envelopeVersion: input.envelopeVersion,
        mode: input.mode,
        passwordKek: input.passwordKek,
        privateKey: input.privateKey,
        secretVersion: input.secretVersion,
        tenantId: input.tenantId,
        userId: input.userId,
        walletId: input.walletId,
      });
      return {
        address: address.checksumAddress,
        addressLower: address.lowercaseAddress,
        envelope,
        mode: input.mode,
        name: input.name,
      };
    } finally {
      this.#zeroize("dek", dek);
    }
  }

  async openAndVerify(input: {
    envelope: CustodyEnvelope;
    passwordKek?: Uint8Array | undefined;
    wallet: StoredCustodyWallet;
  }): Promise<{ address: `0x${string}`; verified: true }> {
    const material = await this.#openMaterial(input);
    try {
      return { address: deriveEvmAddress(material.privateKey).checksumAddress, verified: true };
    } finally {
      this.#zeroize("private-key", material.privateKey);
      this.#zeroize("dek", material.dek);
    }
  }

  async signAndDeliverTransfer(input: {
    delivery: RawTransactionDelivery;
    envelope: CustodyEnvelope;
    now?: Date;
    passwordKek?: Uint8Array | undefined;
    plan: WalletTransferPlan;
    planDigest: `sha256:${string}`;
    wallet: StoredCustodyWallet;
  }): Promise<WalletTransferSigningResult> {
    const now = input.now ?? new Date();
    try {
      validateWalletTransferPlan(input.plan, now);
    } catch (error) {
      throw new SignerError(
        error instanceof Error && error.message === "TRANSFER_PLAN_EXPIRED"
          ? "TRANSFER_PLAN_EXPIRED"
          : "TRANSFER_PLAN_REJECTED",
      );
    }
    if (
      walletTransferPlanDigest(input.plan) !== input.planDigest ||
      input.plan.walletId !== input.wallet.walletId ||
      input.plan.walletAddress !== input.wallet.addressLower ||
      input.wallet.lockStatus !== "ready"
    ) {
      throw new SignerError("TRANSFER_PLAN_REJECTED");
    }
    const nonce = Number(input.plan.nonce);
    if (!Number.isSafeInteger(nonce) || nonce < 0) {
      throw new SignerError("TRANSFER_PLAN_REJECTED");
    }
    const material = await this.#openMaterial({
      envelope: input.envelope,
      passwordKek: input.passwordKek,
      wallet: input.wallet,
    });
    let rawBytes: Buffer | null = null;
    try {
      const account = privateKeyToAccount(
        `0x${Buffer.from(material.privateKey).toString("hex")}` as Hex,
      );
      const rawTransaction = await account.signTransaction({
        chainId: input.plan.chainId,
        data: input.plan.transactionData,
        gas: BigInt(input.plan.feeLimit.gasLimit),
        maxFeePerGas: BigInt(input.plan.feeLimit.maxFeePerGasBaseUnit),
        maxPriorityFeePerGas: BigInt(input.plan.feeLimit.maxPriorityFeePerGasBaseUnit),
        nonce,
        to: input.plan.transactionTarget,
        type: "eip1559",
        value: BigInt(input.plan.transactionValueBaseUnit),
      });
      const transactionHash = keccak256(rawTransaction);
      rawBytes = Buffer.from(rawTransaction.slice(2), "hex");
      let delivered;
      try {
        delivered = await input.delivery.deliver({
          chainId: input.plan.chainId,
          operationId: input.plan.operationId,
          rawTransaction: rawBytes,
          transactionHash,
        });
      } catch (error) {
        if (error instanceof SignerError) throw error;
        throw new SignerError("TRANSFER_DELIVERY_UNAVAILABLE", true);
      }
      if (
        (delivered.status !== "accepted" && delivered.status !== "already-known") ||
        typeof delivered.deliveryId !== "string" ||
        !/^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$/u.test(delivered.deliveryId)
      ) {
        throw new SignerError("TRANSFER_DELIVERY_UNAVAILABLE", true);
      }
      return {
        ...delivered,
        planDigest: input.planDigest,
        transactionHash,
      };
    } finally {
      rawBytes?.fill(0);
      this.#zeroize("private-key", material.privateKey);
      this.#zeroize("dek", material.dek);
    }
  }

  async signAndDeliverHelperDeployment(input: {
    delivery: RawTransactionDelivery;
    envelope: CustodyEnvelope;
    now?: Date;
    passwordKek?: Uint8Array | undefined;
    plan: HelperDeploymentPlan;
    planDigest: `sha256:${string}`;
    wallet: StoredCustodyWallet;
  }): Promise<HelperDeploymentSigningResult> {
    const now = input.now ?? new Date();
    const registry = P05_HELPER_DEPLOYMENT_REGISTRY;
    const material = buildWalletHelperV1DeploymentMaterial(input.plan.wallet.address, registry);
    try {
      validateHelperDeploymentPlan(
        input.plan,
        {
          adapter: helperDeploymentComponent("adapter", registry).address,
          chainId: 31_337,
          constructorArgumentsHash: material.constructorArgumentsHash,
          creationCodeHash: registry.helperTemplate.creationCodeHash,
          expectedAddress: getContractAddress({
            from: input.plan.wallet.address,
            nonce: BigInt(input.plan.nonce),
          }).toLowerCase() as `0x${string}`,
          expectedRuntimeCodeHash: input.plan.deployment.expectedRuntimeCodeHash,
          helperVersion: "WalletHelperV1",
          initCode: material.initCode,
          initCodeHash: material.initCodeHash,
          owner: input.wallet.addressLower,
          permit2: helperDeploymentComponent("permit2", registry).address,
          registryDigest: registry.registryDigest,
          registryRollbackVersion: registry.rollbackVersion,
          registryValidFromBlock: registry.validFromBlock,
          registryValidToBlock: registry.validToBlock,
          registryVersion: registry.registryVersion,
          tokenA: registry.tokens[0],
          tokenB: registry.tokens[1],
        },
        now,
      );
    } catch {
      throw new SignerError(
        input.plan.deadline <= now.toISOString() ? "HELPER_PLAN_EXPIRED" : "HELPER_PLAN_REJECTED",
      );
    }
    if (
      helperDeploymentPlanDigest(input.plan) !== input.planDigest ||
      input.plan.planDigest !== input.planDigest ||
      input.plan.wallet.walletId !== input.wallet.walletId ||
      input.plan.wallet.address !== input.wallet.addressLower ||
      input.plan.transaction.to !== null ||
      input.plan.transaction.valueBaseUnit !== "0" ||
      input.wallet.lockStatus !== "ready"
    ) {
      throw new SignerError("HELPER_PLAN_REJECTED");
    }
    const nonce = Number(input.plan.nonce);
    if (!Number.isSafeInteger(nonce) || nonce < 0) {
      throw new SignerError("HELPER_PLAN_REJECTED");
    }
    const opened = await this.#openMaterial({
      envelope: input.envelope,
      passwordKek: input.passwordKek,
      wallet: input.wallet,
    });
    let rawBytes: Buffer | null = null;
    try {
      const account = privateKeyToAccount(
        `0x${Buffer.from(opened.privateKey).toString("hex")}` as Hex,
      );
      const rawTransaction = await account.signTransaction({
        chainId: 31_337,
        data: input.plan.transaction.data,
        gas: BigInt(input.plan.feeLimit.gasLimit),
        maxFeePerGas: BigInt(input.plan.feeLimit.maxFeePerGasBaseUnit),
        maxPriorityFeePerGas: BigInt(input.plan.feeLimit.maxPriorityFeePerGasBaseUnit),
        nonce,
        type: "eip1559",
        value: 0n,
      });
      const transactionHash = keccak256(rawTransaction);
      rawBytes = Buffer.from(rawTransaction.slice(2), "hex");
      let delivered;
      try {
        delivered = await input.delivery.deliver({
          chainId: 31_337,
          operationId: input.plan.operationId,
          rawTransaction: rawBytes,
          transactionHash,
        });
      } catch {
        throw new SignerError("HELPER_DELIVERY_UNAVAILABLE", true);
      }
      if (
        (delivered.status !== "accepted" && delivered.status !== "already-known") ||
        typeof delivered.deliveryId !== "string" ||
        !/^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$/u.test(delivered.deliveryId)
      ) {
        throw new SignerError("HELPER_DELIVERY_UNAVAILABLE", true);
      }
      return { ...delivered, planDigest: input.planDigest, transactionHash };
    } finally {
      rawBytes?.fill(0);
      this.#zeroize("private-key", opened.privateKey);
      this.#zeroize("dek", opened.dek);
    }
  }

  async signAndDeliverLocalHelperUpgrade(input: {
    delivery: RawTransactionDelivery;
    envelope: CustodyEnvelope;
    generation: number;
    maxFeePerGasBaseUnit: string;
    maxPriorityFeePerGasBaseUnit: string;
    now?: Date;
    operationId: string;
    passwordKek?: Uint8Array | undefined;
    plan: LocalHelperUpgradePlan;
    planDigest: `sha256:${string}`;
    wallet: StoredCustodyWallet;
  }): Promise<LocalHelperUpgradeSigningResult> {
    const now = input.now ?? new Date();
    const registry = P05_LOCAL_HELPER_UPGRADE_REGISTRY;
    const material = buildWalletHelperV2DeploymentMaterial(input.plan.wallet.address, registry);
    const adapter = helperDeploymentComponent("adapter", P05_HELPER_DEPLOYMENT_REGISTRY);
    const permit2 = helperDeploymentComponent("permit2", P05_HELPER_DEPLOYMENT_REGISTRY);
    let validPlan = true;
    try {
      validateLocalHelperUpgradePlan(
        input.plan,
        {
          abiHash: registry.target.abiHash,
          adapter: adapter.address,
          constructorArgumentsHash: material.constructorArgumentsHash,
          creationCodeHash: registry.target.creationCodeHash,
          expectedAddress: getContractAddress({
            from: input.plan.wallet.address,
            nonce: BigInt(input.plan.nonce),
          }).toLowerCase() as `0x${string}`,
          expectedRuntimeCodeHash: input.plan.target.expectedRuntimeCodeHash,
          initCode: material.initCode,
          initCodeHash: material.initCodeHash,
          owner: input.wallet.addressLower,
          permit2: permit2.address,
          registryDigest: registry.registryDigest,
          selectorSetHash: localHelperUpgradeSelectorSetHash(registry.target.selectors),
          sourceBinding: {
            adapterAddress: adapter.address,
            bindingId: input.plan.source.bindingId,
            deploymentRegistryVersion: registry.source.bindingRegistryVersion,
            helperAddress: input.plan.source.helperAddress,
            helperVersion: "WalletHelperV1",
            ownerAddress: input.wallet.addressLower,
            permit2Address: permit2.address,
            runtimeCodeHash: input.plan.source.runtimeCodeHash,
            state: "active",
            verifiedBlockNumber: input.plan.snapshot.blockNumber,
            walletId: input.wallet.walletId,
          },
          tokenA: P05_HELPER_DEPLOYMENT_REGISTRY.tokens[0],
          tokenB: P05_HELPER_DEPLOYMENT_REGISTRY.tokens[1],
        },
        now,
      );
    } catch {
      validPlan = false;
    }
    const maxFee = /^(?:0|[1-9][0-9]*)$/u.test(input.maxFeePerGasBaseUnit)
      ? BigInt(input.maxFeePerGasBaseUnit)
      : 0n;
    const priority = /^(?:0|[1-9][0-9]*)$/u.test(input.maxPriorityFeePerGasBaseUnit)
      ? BigInt(input.maxPriorityFeePerGasBaseUnit)
      : -1n;
    if (
      !validPlan ||
      input.plan.deadline <= now.toISOString() ||
      input.plan.chainId !== 31_337 ||
      input.plan.operationId !== input.operationId ||
      input.plan.planDigest !== input.planDigest ||
      localHelperUpgradePlanDigest(input.plan) !== input.planDigest ||
      input.plan.registry.version !== registry.registryVersion ||
      input.plan.registry.digest !== registry.registryDigest ||
      input.plan.wallet.walletId !== input.wallet.walletId ||
      input.plan.wallet.address !== input.wallet.addressLower ||
      input.plan.target.owner !== input.wallet.addressLower ||
      input.plan.transaction.to !== null ||
      input.plan.transaction.valueBaseUnit !== "0" ||
      input.plan.transaction.data !== material.initCode ||
      input.plan.transaction.dataHash !== material.initCodeHash ||
      input.wallet.lockStatus !== "ready" ||
      !Number.isSafeInteger(input.generation) ||
      input.generation < 0 ||
      maxFee <= 0n ||
      priority < 0n ||
      priority > maxFee ||
      maxFee > BigInt(input.plan.feeLimit.maxFeePerGasBaseUnit) ||
      priority > BigInt(input.plan.feeLimit.maxPriorityFeePerGasBaseUnit) ||
      BigInt(input.plan.feeLimit.gasLimit) * maxFee > BigInt(input.plan.feeLimit.feeCapBaseUnit)
    ) {
      throw new SignerError(
        input.plan.deadline <= now.toISOString()
          ? "LOCAL_HELPER_UPGRADE_PLAN_EXPIRED"
          : "LOCAL_HELPER_UPGRADE_PLAN_REJECTED",
      );
    }
    const nonce = Number(input.plan.nonce);
    if (!Number.isSafeInteger(nonce) || nonce < 0) {
      throw new SignerError("LOCAL_HELPER_UPGRADE_PLAN_REJECTED");
    }
    const opened = await this.#openMaterial({
      envelope: input.envelope,
      passwordKek: input.passwordKek,
      wallet: input.wallet,
    });
    let rawBytes: Buffer | null = null;
    try {
      const account = privateKeyToAccount(
        `0x${Buffer.from(opened.privateKey).toString("hex")}` as Hex,
      );
      const rawTransaction = await account.signTransaction({
        chainId: 31_337,
        data: input.plan.transaction.data,
        gas: BigInt(input.plan.feeLimit.gasLimit),
        maxFeePerGas: maxFee,
        maxPriorityFeePerGas: priority,
        nonce,
        type: "eip1559",
        value: 0n,
      });
      const transactionHash = keccak256(rawTransaction);
      rawBytes = Buffer.from(rawTransaction.slice(2), "hex");
      let delivered;
      try {
        delivered = await input.delivery.deliver({
          chainId: 31_337,
          operationId: input.operationId,
          rawTransaction: rawBytes,
          transactionHash,
        });
      } catch {
        throw new SignerError("LOCAL_HELPER_UPGRADE_DELIVERY_UNAVAILABLE", true);
      }
      if (
        (delivered.status !== "accepted" && delivered.status !== "already-known") ||
        typeof delivered.deliveryId !== "string" ||
        !/^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$/u.test(delivered.deliveryId)
      ) {
        throw new SignerError("LOCAL_HELPER_UPGRADE_DELIVERY_UNAVAILABLE", true);
      }
      return {
        ...delivered,
        generation: input.generation,
        operationId: input.operationId,
        planDigest: input.planDigest,
        transactionHash,
      };
    } finally {
      rawBytes?.fill(0);
      this.#zeroize("private-key", opened.privateKey);
      this.#zeroize("dek", opened.dek);
    }
  }

  async signAndDeliverLocalSwapStep(input: {
    delivery: RawTransactionDelivery;
    envelope: CustodyEnvelope;
    generation: number;
    maxFeePerGasBaseUnit: string;
    maxPriorityFeePerGasBaseUnit: string;
    now?: Date;
    passwordKek?: Uint8Array | undefined;
    plan: LocalSwapExecutionPlan;
    planDigest: `sha256:${string}`;
    stepId: string;
    wallet: StoredCustodyWallet;
  }): Promise<LocalSwapStepSigningResult> {
    const now = input.now ?? new Date();
    const step = input.plan.steps.find(({ stepId }) => stepId === input.stepId);
    const maxFee = /^(?:0|[1-9][0-9]*)$/u.test(input.maxFeePerGasBaseUnit)
      ? BigInt(input.maxFeePerGasBaseUnit)
      : 0n;
    const priority = /^(?:0|[1-9][0-9]*)$/u.test(input.maxPriorityFeePerGasBaseUnit)
      ? BigInt(input.maxPriorityFeePerGasBaseUnit)
      : -1n;
    if (
      !step ||
      input.plan.deadline <= now.toISOString() ||
      input.plan.chainId !== 31_337 ||
      input.plan.planDigest !== input.planDigest ||
      localSwapExecutionPlanDigest(input.plan) !== input.planDigest ||
      input.plan.registry.version !== "p05-local-swap-execution-v2" ||
      input.plan.serviceFeeBps !== 0 ||
      input.plan.wallet.walletId !== input.wallet.walletId ||
      input.plan.wallet.address !== input.wallet.addressLower ||
      input.plan.helper.owner !== input.wallet.addressLower ||
      input.wallet.lockStatus !== "ready" ||
      !Number.isSafeInteger(input.generation) ||
      input.generation < 0 ||
      maxFee <= 0n ||
      priority < 0n ||
      priority > maxFee ||
      maxFee > BigInt(step.feeLimit.maxFeePerGasBaseUnit) ||
      priority > BigInt(step.feeLimit.maxPriorityFeePerGasBaseUnit) ||
      (step.kind === "swap"
        ? step.transaction.to !== input.plan.helper.address ||
          !step.transaction.data.startsWith("0x5a547e89")
        : step.transaction.to !== input.plan.quote.tokenIn ||
          !step.transaction.data.startsWith("0x095ea7b3"))
    ) {
      throw new SignerError(
        input.plan.deadline <= now.toISOString()
          ? "LOCAL_SWAP_PLAN_EXPIRED"
          : "LOCAL_SWAP_PLAN_REJECTED",
      );
    }
    const nonce = Number(step.nonce);
    if (!Number.isSafeInteger(nonce) || nonce < 0) {
      throw new SignerError("LOCAL_SWAP_PLAN_REJECTED");
    }
    const opened = await this.#openMaterial({
      envelope: input.envelope,
      passwordKek: input.passwordKek,
      wallet: input.wallet,
    });
    let rawBytes: Buffer | null = null;
    try {
      const account = privateKeyToAccount(
        `0x${Buffer.from(opened.privateKey).toString("hex")}` as Hex,
      );
      const rawTransaction = await account.signTransaction({
        chainId: 31_337,
        data: step.transaction.data,
        gas: BigInt(step.feeLimit.gasLimit),
        maxFeePerGas: maxFee,
        maxPriorityFeePerGas: priority,
        nonce,
        to: step.transaction.to,
        type: "eip1559",
        value: 0n,
      });
      const transactionHash = keccak256(rawTransaction);
      rawBytes = Buffer.from(rawTransaction.slice(2), "hex");
      let delivered;
      try {
        delivered = await input.delivery.deliver({
          chainId: 31_337,
          operationId: input.plan.operationId,
          rawTransaction: rawBytes,
          transactionHash,
        });
      } catch {
        throw new SignerError("LOCAL_SWAP_DELIVERY_UNAVAILABLE", true);
      }
      if (
        (delivered.status !== "accepted" && delivered.status !== "already-known") ||
        typeof delivered.deliveryId !== "string" ||
        !/^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$/u.test(delivered.deliveryId)
      ) {
        throw new SignerError("LOCAL_SWAP_DELIVERY_UNAVAILABLE", true);
      }
      return {
        ...delivered,
        generation: input.generation,
        planDigest: input.planDigest,
        stepId: input.stepId,
        transactionHash,
      };
    } finally {
      rawBytes?.fill(0);
      this.#zeroize("private-key", opened.privateKey);
      this.#zeroize("dek", opened.dek);
    }
  }

  async signAndDeliverLocalPositionStep(input: {
    delivery: RawTransactionDelivery;
    envelope: CustodyEnvelope;
    generation: number;
    maxFeePerGasBaseUnit: string;
    maxPriorityFeePerGasBaseUnit: string;
    now?: Date;
    passwordKek?: Uint8Array | undefined;
    plan: LocalPositionExecutionPlan;
    planDigest: `sha256:${string}`;
    stepId: string;
    wallet: StoredCustodyWallet;
  }): Promise<LocalPositionStepSigningResult> {
    const now = input.now ?? new Date();
    const step = input.plan.steps.find(({ stepId }) => stepId === input.stepId);
    const maxFee = /^(?:0|[1-9][0-9]*)$/u.test(input.maxFeePerGasBaseUnit)
      ? BigInt(input.maxFeePerGasBaseUnit)
      : 0n;
    const priority = /^(?:0|[1-9][0-9]*)$/u.test(input.maxPriorityFeePerGasBaseUnit)
      ? BigInt(input.maxPriorityFeePerGasBaseUnit)
      : -1n;
    const registry = P05_LOCAL_POSITION_EXECUTION_REGISTRY;
    const expectedSelector = step
      ? step.kind === "decrease"
        ? registry.manager.selectors.decreaseLiquidity
        : registry.manager.selectors[step.kind]
      : null;
    if (
      !step ||
      input.plan.deadline <= now.toISOString() ||
      input.plan.chainId !== 31_337 ||
      input.plan.planDigest !== input.planDigest ||
      localPositionExecutionPlanDigest(input.plan) !== input.planDigest ||
      input.plan.registry.version !== registry.registryVersion ||
      input.plan.registry.digest !== registry.registryDigest ||
      input.plan.serviceFeeBps !== 0 ||
      input.plan.wallet.walletId !== input.wallet.walletId ||
      input.plan.wallet.address !== input.wallet.addressLower ||
      input.plan.snapshot.position.owner !== input.wallet.addressLower ||
      input.plan.manager.address !== registry.manager.address ||
      input.plan.manager.abiHash !== registry.manager.abiHash ||
      input.plan.manager.runtimeCodeHash !== registry.manager.runtimeCodeHash ||
      input.wallet.lockStatus !== "ready" ||
      !Number.isSafeInteger(input.generation) ||
      input.generation < 0 ||
      maxFee <= 0n ||
      priority < 0n ||
      priority > maxFee ||
      maxFee > BigInt(step.feeLimit.maxFeePerGasBaseUnit) ||
      priority > BigInt(step.feeLimit.maxPriorityFeePerGasBaseUnit) ||
      step.transaction.to !== registry.manager.address ||
      expectedSelector === null ||
      !step.transaction.data.startsWith(expectedSelector)
    ) {
      throw new SignerError(
        input.plan.deadline <= now.toISOString()
          ? "LOCAL_POSITION_PLAN_EXPIRED"
          : "LOCAL_POSITION_PLAN_REJECTED",
      );
    }
    const nonce = Number(step.nonce);
    if (!Number.isSafeInteger(nonce) || nonce < 0) {
      throw new SignerError("LOCAL_POSITION_PLAN_REJECTED");
    }
    const opened = await this.#openMaterial({
      envelope: input.envelope,
      passwordKek: input.passwordKek,
      wallet: input.wallet,
    });
    let rawBytes: Buffer | null = null;
    try {
      const account = privateKeyToAccount(
        `0x${Buffer.from(opened.privateKey).toString("hex")}` as Hex,
      );
      const rawTransaction = await account.signTransaction({
        chainId: 31_337,
        data: step.transaction.data,
        gas: BigInt(step.feeLimit.gasLimit),
        maxFeePerGas: maxFee,
        maxPriorityFeePerGas: priority,
        nonce,
        to: step.transaction.to,
        type: "eip1559",
        value: 0n,
      });
      const transactionHash = keccak256(rawTransaction);
      rawBytes = Buffer.from(rawTransaction.slice(2), "hex");
      let delivered;
      try {
        delivered = await input.delivery.deliver({
          chainId: 31_337,
          operationId: input.plan.operationId,
          rawTransaction: rawBytes,
          transactionHash,
        });
      } catch {
        throw new SignerError("LOCAL_POSITION_DELIVERY_UNAVAILABLE", true);
      }
      if (
        (delivered.status !== "accepted" && delivered.status !== "already-known") ||
        typeof delivered.deliveryId !== "string" ||
        !/^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$/u.test(delivered.deliveryId)
      ) {
        throw new SignerError("LOCAL_POSITION_DELIVERY_UNAVAILABLE", true);
      }
      return {
        ...delivered,
        generation: input.generation,
        planDigest: input.planDigest,
        stepId: input.stepId,
        transactionHash,
      };
    } finally {
      rawBytes?.fill(0);
      this.#zeroize("private-key", opened.privateKey);
      this.#zeroize("dek", opened.dek);
    }
  }

  async signAndDeliverLocalHelperSweep(input: {
    delivery: RawTransactionDelivery;
    envelope: CustodyEnvelope;
    generation: number;
    maxFeePerGasBaseUnit: string;
    maxPriorityFeePerGasBaseUnit: string;
    now?: Date;
    operationId: string;
    passwordKek?: Uint8Array | undefined;
    plan: LocalHelperSweepPlan;
    planDigest: `sha256:${string}`;
    wallet: StoredCustodyWallet;
  }): Promise<LocalHelperSweepSigningResult> {
    const now = input.now ?? new Date();
    const maxFee = /^(?:0|[1-9][0-9]*)$/u.test(input.maxFeePerGasBaseUnit)
      ? BigInt(input.maxFeePerGasBaseUnit)
      : 0n;
    const priority = /^(?:0|[1-9][0-9]*)$/u.test(input.maxPriorityFeePerGasBaseUnit)
      ? BigInt(input.maxPriorityFeePerGasBaseUnit)
      : -1n;
    const registry = P05_LOCAL_HELPER_SWEEP_REGISTRY;
    let validPlan = true;
    try {
      validateLocalHelperSweepPlan(
        input.plan,
        {
          currentBlockHash: input.plan.snapshot.blockHash,
          currentBlockNumber: input.plan.snapshot.blockNumber,
          expectedAsset: structuredClone(input.plan.asset),
          expectedBinding: { ...input.plan.helper, state: "degraded" },
          expectedWallet: structuredClone(input.plan.wallet),
          registryDigest: registry.registryDigest,
        },
        now,
      );
    } catch {
      validPlan = false;
    }
    const calldata = localHelperSweepCalldata(input.plan.planDigest, input.plan.asset);
    if (
      !validPlan ||
      input.plan.deadline <= now.toISOString() ||
      input.plan.chainId !== 31_337 ||
      input.plan.operationId !== input.operationId ||
      input.plan.planDigest !== input.planDigest ||
      localHelperSweepPlanDigest(input.plan) !== input.planDigest ||
      input.plan.registry.version !== registry.registryVersion ||
      input.plan.registry.digest !== registry.registryDigest ||
      input.plan.serviceFeeBps !== 0 ||
      input.plan.wallet.walletId !== input.wallet.walletId ||
      input.plan.wallet.address !== input.wallet.addressLower ||
      input.plan.helper.ownerAddress !== input.wallet.addressLower ||
      input.plan.recipient !== input.wallet.addressLower ||
      input.plan.transaction.to !== input.plan.helper.helperAddress ||
      input.plan.transaction.valueBaseUnit !== "0" ||
      input.plan.transaction.data !== calldata ||
      input.plan.transaction.dataDigest !== localHelperSweepDataDigest(calldata) ||
      input.plan.semanticDigest !== localHelperSweepSemanticDigest(input.plan) ||
      input.wallet.lockStatus !== "ready" ||
      !Number.isSafeInteger(input.generation) ||
      input.generation < 0 ||
      maxFee <= 0n ||
      priority < 0n ||
      priority > maxFee ||
      maxFee > BigInt(input.plan.feeLimit.maxFeePerGasBaseUnit) ||
      priority > BigInt(input.plan.feeLimit.maxPriorityFeePerGasBaseUnit)
    ) {
      throw new SignerError(
        input.plan.deadline <= now.toISOString()
          ? "LOCAL_HELPER_SWEEP_PLAN_EXPIRED"
          : "LOCAL_HELPER_SWEEP_PLAN_REJECTED",
      );
    }
    const nonce = Number(input.plan.nonce);
    if (!Number.isSafeInteger(nonce) || nonce < 0) {
      throw new SignerError("LOCAL_HELPER_SWEEP_PLAN_REJECTED");
    }
    const opened = await this.#openMaterial({
      envelope: input.envelope,
      passwordKek: input.passwordKek,
      wallet: input.wallet,
    });
    let rawBytes: Buffer | null = null;
    try {
      const account = privateKeyToAccount(
        `0x${Buffer.from(opened.privateKey).toString("hex")}` as Hex,
      );
      const rawTransaction = await account.signTransaction({
        chainId: 31_337,
        data: input.plan.transaction.data,
        gas: BigInt(input.plan.feeLimit.gasLimit),
        maxFeePerGas: maxFee,
        maxPriorityFeePerGas: priority,
        nonce,
        to: input.plan.transaction.to,
        type: "eip1559",
        value: 0n,
      });
      const transactionHash = keccak256(rawTransaction);
      rawBytes = Buffer.from(rawTransaction.slice(2), "hex");
      let delivered;
      try {
        delivered = await input.delivery.deliver({
          chainId: 31_337,
          operationId: input.operationId,
          rawTransaction: rawBytes,
          transactionHash,
        });
      } catch {
        throw new SignerError("LOCAL_HELPER_SWEEP_DELIVERY_UNAVAILABLE", true);
      }
      if (
        (delivered.status !== "accepted" && delivered.status !== "already-known") ||
        typeof delivered.deliveryId !== "string" ||
        !/^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$/u.test(delivered.deliveryId)
      ) {
        throw new SignerError("LOCAL_HELPER_SWEEP_DELIVERY_UNAVAILABLE", true);
      }
      return {
        ...delivered,
        generation: input.generation,
        operationId: input.operationId,
        planDigest: input.planDigest,
        transactionHash,
      };
    } finally {
      rawBytes?.fill(0);
      this.#zeroize("private-key", opened.privateKey);
      this.#zeroize("dek", opened.dek);
    }
  }

  async signLocalSwapPermit2Authorization(input: {
    envelope: CustodyEnvelope;
    passwordKek?: Uint8Array | undefined;
    payload: LocalSwapPermit2SigningPayload;
    wallet: StoredCustodyWallet;
  }): Promise<LocalSwapPermit2SigningResult> {
    let authorizationDigest: `0x${string}`;
    try {
      authorizationDigest = localSwapPermit2AuthorizationDigest(input.payload);
    } catch {
      throw new SignerError("PERMIT2_AUTHORIZATION_REJECTED");
    }
    if (input.payload.walletId !== input.wallet.walletId || input.wallet.lockStatus !== "ready") {
      throw new SignerError("PERMIT2_AUTHORIZATION_REJECTED");
    }
    const opened = await this.#openMaterial({
      envelope: input.envelope,
      passwordKek: input.passwordKek,
      wallet: input.wallet,
    });
    try {
      const account = privateKeyToAccount(
        `0x${Buffer.from(opened.privateKey).toString("hex")}` as Hex,
      );
      return {
        authorizationDigest,
        signature: await account.sign({ hash: authorizationDigest }),
      };
    } finally {
      this.#zeroize("private-key", opened.privateKey);
      this.#zeroize("dek", opened.dek);
    }
  }

  async rekeyEnvelope(input: {
    envelope: CustodyEnvelope;
    passwordKek?: Uint8Array | undefined;
    targetMode: WalletEncryptionMode;
    targetPasswordKek?: Uint8Array | undefined;
    targetSecretVersion?: number | undefined;
    wallet: StoredCustodyWallet;
  }): Promise<CustodyEnvelope> {
    const material = await this.#openMaterial({
      envelope: input.envelope,
      passwordKek: input.passwordKek,
      wallet: input.wallet,
    });
    try {
      return await this.#sealMaterial({
        addressLower: input.wallet.addressLower,
        dek: material.dek,
        envelopeVersion: input.envelope.envelopeVersion + 1,
        mode: input.targetMode,
        passwordKek: input.targetPasswordKek,
        privateKey: material.privateKey,
        secretVersion: input.targetSecretVersion,
        tenantId: input.wallet.tenantId,
        userId: input.wallet.userId,
        walletId: input.wallet.walletId,
      });
    } finally {
      this.#zeroize("private-key", material.privateKey);
      this.#zeroize("dek", material.dek);
    }
  }

  async #sealMaterial(input: {
    addressLower: `0x${string}`;
    dek: Uint8Array;
    envelopeVersion: number;
    mode: WalletEncryptionMode;
    passwordKek?: Uint8Array | undefined;
    privateKey: Uint8Array;
    secretVersion?: number | undefined;
    tenantId: string;
    userId: string;
    walletId: string;
  }): Promise<CustodyEnvelope> {
    if (input.mode !== "server-kek" && input.mode !== "user-password") {
      throw new SignerError("INVALID_MODE");
    }
    const mainNonce = bufferView(this.#secretRandomBytes(12));
    if (mainNonce.length !== 12) {
      mainNonce.fill(0);
      throw new SignerError("SIGNER_UNAVAILABLE", true);
    }
    let aad: Buffer | null = null;
    let wrapAad: Buffer | null = null;
    let wrapNonce: Buffer | null = null;
    try {
      if (input.mode === "server-kek") {
        const key = await this.#kms.activeKey();
        aad = buildWalletAad({
          address: input.addressLower,
          envelopeVersion: input.envelopeVersion,
          kekVersion: key.kekVersion,
          mode: input.mode,
          tenantId: input.tenantId,
          userId: input.userId,
          walletId: input.walletId,
        });
        const sealed = sealEnvelope({
          aad,
          dek: input.dek,
          nonce: mainNonce,
          plaintext: input.privateKey,
        });
        const wrapped = await this.#kms.wrapDek({ dek: input.dek, key });
        return {
          aadVersion: 1,
          algorithm: "AES-256-GCM",
          ciphertext: sealed.ciphertext,
          createdAt: new Date(),
          dekWrapNonce: null,
          dekWrapTag: null,
          dekWrapVersion: 1,
          envelopeVersion: input.envelopeVersion,
          kekId: wrapped.kekId,
          kekVersion: wrapped.kekVersion,
          nonce: sealed.nonce,
          secretVersion: null,
          tag: sealed.tag,
          wrappedDek: wrapped.wrappedDek,
        };
      }

      if (
        !input.passwordKek ||
        input.passwordKek.length !== 32 ||
        !Number.isSafeInteger(input.secretVersion) ||
        input.secretVersion! < 1
      ) {
        throw new SignerError("INVALID_CREDENTIALS");
      }
      const kekVersion = `secret-v${input.secretVersion}`;
      aad = buildWalletAad({
        address: input.addressLower,
        envelopeVersion: input.envelopeVersion,
        kekVersion,
        mode: input.mode,
        tenantId: input.tenantId,
        userId: input.userId,
        walletId: input.walletId,
      });
      const sealed = sealEnvelope({
        aad,
        dek: input.dek,
        nonce: mainNonce,
        plaintext: input.privateKey,
      });
      wrapAad = buildPasswordDekWrapAad({
        envelopeVersion: input.envelopeVersion,
        secretVersion: input.secretVersion!,
        tenantId: input.tenantId,
        userId: input.userId,
        walletId: input.walletId,
        wrapVersion: 1,
      });
      wrapNonce = bufferView(this.#secretRandomBytes(12));
      const wrapped = sealPasswordDekWrap({
        aad: wrapAad,
        dek: input.dek,
        kek: input.passwordKek,
        nonce: wrapNonce,
      });
      return {
        aadVersion: 1,
        algorithm: "AES-256-GCM",
        ciphertext: sealed.ciphertext,
        createdAt: new Date(),
        dekWrapNonce: wrapped.nonce,
        dekWrapTag: wrapped.tag,
        dekWrapVersion: wrapped.wrapVersion,
        envelopeVersion: input.envelopeVersion,
        kekId: "user-password",
        kekVersion,
        nonce: sealed.nonce,
        secretVersion: input.secretVersion!,
        tag: sealed.tag,
        wrappedDek: wrapped.wrappedDek,
      };
    } finally {
      mainNonce.fill(0);
      wrapNonce?.fill(0);
      aad?.fill(0);
      wrapAad?.fill(0);
    }
  }

  async #openMaterial(input: {
    envelope: CustodyEnvelope;
    passwordKek?: Uint8Array | undefined;
    wallet: StoredCustodyWallet;
  }): Promise<{ dek: Buffer; privateKey: Buffer }> {
    const { envelope, wallet } = input;
    const passwordMode = wallet.mode === "user-password";
    let dek: Buffer | null = null;
    let privateKey: Buffer | null = null;
    let aad: Buffer | null = null;
    let wrapAad: Buffer | null = null;
    try {
      if (
        envelope.algorithm !== "AES-256-GCM" ||
        envelope.aadVersion !== 1 ||
        envelope.envelopeVersion !== wallet.envelopeVersion ||
        (wallet.mode !== "server-kek" && wallet.mode !== "user-password")
      ) {
        throw new SignerError(passwordMode ? "INVALID_CREDENTIALS" : "KEYSTORE_CORRUPTED");
      }
      if (passwordMode) {
        if (
          !input.passwordKek ||
          envelope.dekWrapVersion !== 1 ||
          !envelope.dekWrapNonce ||
          !envelope.dekWrapTag ||
          !envelope.secretVersion
        ) {
          throw new SignerError("INVALID_CREDENTIALS");
        }
        wrapAad = buildPasswordDekWrapAad({
          envelopeVersion: envelope.envelopeVersion,
          secretVersion: envelope.secretVersion,
          tenantId: wallet.tenantId,
          userId: wallet.userId,
          walletId: wallet.walletId,
          wrapVersion: 1,
        });
        dek = openPasswordDekWrap({
          aad: wrapAad,
          kek: input.passwordKek,
          nonce: envelope.dekWrapNonce,
          tag: envelope.dekWrapTag,
          wrapVersion: envelope.dekWrapVersion,
          wrappedDek: envelope.wrappedDek,
        });
      } else {
        dek = await this.#kms.unwrapDek(envelope);
      }
      aad = buildWalletAad({
        address: wallet.addressLower,
        envelopeVersion: envelope.envelopeVersion,
        kekVersion: envelope.kekVersion,
        mode: wallet.mode,
        tenantId: wallet.tenantId,
        userId: wallet.userId,
        walletId: wallet.walletId,
      });
      privateKey = openEnvelope({
        aad,
        ciphertext: envelope.ciphertext,
        dek,
        nonce: envelope.nonce,
        tag: envelope.tag,
      });
      const derived = deriveEvmAddress(privateKey);
      if (derived.lowercaseAddress !== wallet.addressLower) {
        throw new SignerError(passwordMode ? "INVALID_CREDENTIALS" : "KEYSTORE_CORRUPTED");
      }
      return { dek, privateKey };
    } catch (error) {
      if (privateKey) this.#zeroize("private-key", privateKey);
      if (dek) this.#zeroize("dek", dek);
      if (passwordMode) throw new SignerError("INVALID_CREDENTIALS");
      throw error;
    } finally {
      aad?.fill(0);
      wrapAad?.fill(0);
    }
  }

  #zeroize(label: ZeroizeLabel, bytes: Uint8Array): void {
    bytes.fill(0);
    this.#onZeroize(label, bytes);
  }
}
