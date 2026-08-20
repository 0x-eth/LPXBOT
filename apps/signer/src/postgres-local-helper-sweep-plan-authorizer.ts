import { LocalEvmRpcClient, type LocalEvmRpcClientOptions } from "@lpbot/chain-adapters";
import {
  P05_LOCAL_HELPER_SWEEP_REGISTRY,
  validateLocalHelperSweepRegistry,
  type LocalHelperSweepRegistry,
} from "@lpbot/chain-registry";
import {
  validateLocalHelperSweepPlan,
  type LocalHelperSweepPlan,
} from "@lpbot/domain/local-helper-sweep";
import type { Pool, QueryResultRow } from "pg";
import {
  decodeFunctionResult,
  encodeFunctionData,
  keccak256,
  type Address,
  type Hex,
} from "viem";

import type { LocalHelperSweepPlanAuthorizer } from "./custody-types.js";

const helperReadAbi = [
  {
    inputs: [],
    name: "owner",
    outputs: [{ type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "adapter",
    outputs: [{ type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "permit2",
    outputs: [{ type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ type: "bytes32" }],
    name: "executedPlans",
    outputs: [{ type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

interface RpcBlock {
  hash: Hex;
  number: Hex;
}

export interface LocalHelperSweepChainVerification {
  canonicalSnapshotBlockHash: Hex;
  componentCode: readonly {
    address: Address;
    role: "adapter" | "manager" | "permit2" | "router";
    runtimeCodeHash: Hex | null;
  }[];
  headBlockNumber: string;
  helper: {
    adapter: Address;
    executed: boolean;
    owner: Address;
    permit2: Address;
    runtimeCodeHash: Hex | null;
  };
  tokenCode: readonly { address: Address; runtimeCodeHash: Hex | null }[];
}

export interface LocalHelperSweepPlanChainVerifier {
  verify(plan: LocalHelperSweepPlan): Promise<LocalHelperSweepChainVerification>;
}

function quantity(value: unknown): bigint {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/iu.test(value)) {
    throw new Error("LOCAL_HELPER_SWEEP_SIGNER_QUANTITY_INVALID");
  }
  return BigInt(value);
}

function bytecode(value: unknown): Hex {
  if (typeof value !== "string" || !/^0x(?:[0-9a-f]{2})*$/iu.test(value)) {
    throw new Error("LOCAL_HELPER_SWEEP_SIGNER_CODE_INVALID");
  }
  return value.toLowerCase() as Hex;
}

function codeHash(value: Hex): Hex | null {
  return value === "0x" ? null : keccak256(value);
}

export class ViemLocalHelperSweepPlanVerifier implements LocalHelperSweepPlanChainVerifier {
  readonly #client: LocalEvmRpcClient;
  readonly #registry: LocalHelperSweepRegistry;

  constructor(input: {
    chainId: 31_337;
    fetch?: typeof fetch;
    provider: Pick<LocalEvmRpcClientOptions, "providerId" | "rpcUrl">;
    registry?: LocalHelperSweepRegistry;
    timeoutMilliseconds?: number;
  }) {
    if (input.chainId !== 31_337) {
      throw new RangeError("LOCAL_HELPER_SWEEP_SIGNER_CHAIN_INVALID");
    }
    this.#registry = validateLocalHelperSweepRegistry(
      input.registry ?? P05_LOCAL_HELPER_SWEEP_REGISTRY,
    );
    this.#client = new LocalEvmRpcClient({
      expectedChainId: 31_337,
      ...(input.fetch ? { fetch: input.fetch } : {}),
      ...input.provider,
      ...(input.timeoutMilliseconds ? { timeoutMilliseconds: input.timeoutMilliseconds } : {}),
    });
  }

  async verify(plan: LocalHelperSweepPlan): Promise<LocalHelperSweepChainVerification> {
    const call = (functionName: "adapter" | "executedPlans" | "owner" | "permit2") =>
      this.#client.request<Hex>("eth_call", [
        {
          data: encodeFunctionData({
            abi: helperReadAbi,
            args:
              functionName === "executedPlans"
                ? ([`0x${plan.planDigest.slice("sha256:".length)}`] as never)
                : ([] as never),
            functionName,
          }),
          to: plan.helper.helperAddress,
        },
        "latest",
      ]);
    const [
      snapshotBlock,
      head,
      helperCode,
      ownerRaw,
      adapterRaw,
      permit2Raw,
      executedRaw,
      componentCodes,
      tokenCodes,
    ] = await Promise.all([
      this.#client.request<RpcBlock | null>("eth_getBlockByNumber", [
        `0x${BigInt(plan.snapshot.blockNumber).toString(16)}`,
        false,
      ]),
      this.#client.request<Hex>("eth_blockNumber", []),
      this.#client.request<Hex>("eth_getCode", [plan.helper.helperAddress, "latest"]),
      call("owner"),
      call("adapter"),
      call("permit2"),
      call("executedPlans"),
      Promise.all(
        this.#registry.components.map(({ address }) =>
          this.#client.request<Hex>("eth_getCode", [address, "latest"]),
        ),
      ),
      Promise.all(
        this.#registry.tokens.map(({ address }) =>
          this.#client.request<Hex>("eth_getCode", [address, "latest"]),
        ),
      ),
    ]);
    if (!snapshotBlock) throw new Error("LOCAL_HELPER_SWEEP_SIGNER_BLOCK_MISSING");
    return {
      canonicalSnapshotBlockHash: snapshotBlock.hash.toLowerCase() as Hex,
      componentCode: this.#registry.components.map(({ address, role }, index) => ({
        address,
        role,
        runtimeCodeHash: codeHash(bytecode(componentCodes[index])),
      })),
      headBlockNumber: quantity(head).toString(),
      helper: {
        adapter: decodeFunctionResult({
          abi: helperReadAbi,
          data: adapterRaw,
          functionName: "adapter",
        }).toLowerCase() as Address,
        executed: decodeFunctionResult({
          abi: helperReadAbi,
          data: executedRaw,
          functionName: "executedPlans",
        }),
        owner: decodeFunctionResult({
          abi: helperReadAbi,
          data: ownerRaw,
          functionName: "owner",
        }).toLowerCase() as Address,
        permit2: decodeFunctionResult({
          abi: helperReadAbi,
          data: permit2Raw,
          functionName: "permit2",
        }).toLowerCase() as Address,
        runtimeCodeHash: codeHash(bytecode(helperCode)),
      },
      tokenCode: this.#registry.tokens.map(({ address }, index) => ({
        address,
        runtimeCodeHash: codeHash(bytecode(tokenCodes[index])),
      })),
    };
  }
}

interface AuthorizationRow extends QueryResultRow {
  active_generation: number | null;
  active_max_fee: string | null;
  active_max_priority: string | null;
  adapter_address: Address;
  asset_id: string;
  batch_registry_digest: `sha256:${string}`;
  batch_registry_version: string;
  batch_rescan_state: string;
  batch_snapshot_digest: `sha256:${string}`;
  batch_state: string;
  binding_id: string;
  binding_state: string;
  canonical_success_count: string;
  helper_address: Address;
  ledger_fencing_token: string;
  ledger_reconciliation_reason: string | null;
  operation_state: string;
  owner_address: Address;
  permit2_address: Address;
  plan_digest: `sha256:${string}`;
  plan_payload: LocalHelperSweepPlan;
  replacement_amount: string | null;
  replacement_data_digest: `sha256:${string}` | null;
  replacement_expires_at: Date | null;
  replacement_generation: number | null;
  replacement_gas_limit: string | null;
  replacement_max_fee: string | null;
  replacement_max_priority: string | null;
  replacement_plan_digest: `sha256:${string}` | null;
  replacement_recipient: Address | null;
  replacement_semantic_digest: `sha256:${string}` | null;
  replacement_state: string | null;
  runtime_code_hash: Hex;
  snapshot_binding_state: string;
  snapshot_block_hash: Hex;
  snapshot_block_number: string;
  snapshot_coverage_complete: boolean;
  snapshot_manual_recovery_required: boolean;
  snapshot_registry_digest: `sha256:${string}`;
  transaction_count: string;
  wallet_address: Address;
  wallet_lifecycle_status: string;
  wallet_lock_status: string;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export class PostgresLocalHelperSweepPlanAuthorizer implements LocalHelperSweepPlanAuthorizer {
  readonly #now: () => Date;
  readonly #registry: LocalHelperSweepRegistry;

  constructor(
    readonly pool: Pool,
    readonly verifier: LocalHelperSweepPlanChainVerifier,
    input: { now?: () => Date; registry?: LocalHelperSweepRegistry } = {},
  ) {
    this.#now = input.now ?? (() => new Date());
    this.#registry = validateLocalHelperSweepRegistry(
      input.registry ?? P05_LOCAL_HELPER_SWEEP_REGISTRY,
    );
  }

  async authorize(
    input: Parameters<LocalHelperSweepPlanAuthorizer["authorize"]>[0],
  ): Promise<boolean> {
    try {
      const plan = input.plan;
      if (
        plan.operationId !== input.operationId ||
        plan.planDigest !== input.planDigest ||
        !Number.isSafeInteger(input.generation) ||
        input.generation < 0
      ) {
        return false;
      }
      validateLocalHelperSweepPlan(
        plan,
        {
          currentBlockHash: plan.snapshot.blockHash,
          currentBlockNumber: plan.snapshot.blockNumber,
          expectedAsset: structuredClone(plan.asset),
          expectedBinding: { ...plan.helper, state: "degraded" },
          expectedWallet: structuredClone(plan.wallet),
          registryDigest: this.#registry.registryDigest,
        },
        this.#now(),
      );
      const maxFee = BigInt(input.maxFeePerGasBaseUnit);
      const priority = BigInt(input.maxPriorityFeePerGasBaseUnit);
      if (
        maxFee <= 0n ||
        priority < 0n ||
        priority > maxFee ||
        maxFee > BigInt(plan.feeLimit.maxFeePerGasBaseUnit) ||
        priority > BigInt(plan.feeLimit.maxPriorityFeePerGasBaseUnit)
      ) {
        return false;
      }
      const result = await this.pool.query<AuthorizationRow>(
        `SELECT o.state AS operation_state, o.asset_id, o.plan_digest, o.plan_payload,
                batch.state AS batch_state, batch.rescan_state AS batch_rescan_state,
                batch.snapshot_digest AS batch_snapshot_digest,
                batch.registry_version AS batch_registry_version,
                batch.registry_digest AS batch_registry_digest,
                w.address_lower AS wallet_address, w.lifecycle_status AS wallet_lifecycle_status,
                w.lock_status AS wallet_lock_status,
                ledger.fencing_token::text AS ledger_fencing_token,
                ledger.reconciliation_reason AS ledger_reconciliation_reason,
                binding.binding_id::text, binding.state AS binding_state,
                binding.helper_address, binding.owner_address, binding.adapter_address,
                binding.permit2_address, binding.runtime_code_hash,
                snapshot.binding_state AS snapshot_binding_state,
                snapshot.block_hash AS snapshot_block_hash,
                snapshot.block_number::text AS snapshot_block_number,
                snapshot.coverage_complete AS snapshot_coverage_complete,
                snapshot.manual_recovery_required AS snapshot_manual_recovery_required,
                snapshot.registry_digest AS snapshot_registry_digest,
                tx.generation AS active_generation,
                tx.max_fee_per_gas_base_unit::text AS active_max_fee,
                tx.max_priority_fee_per_gas_base_unit::text AS active_max_priority,
                replacement.generation AS replacement_generation,
                replacement.state AS replacement_state,
                replacement.expires_at AS replacement_expires_at,
                replacement.plan_digest AS replacement_plan_digest,
                replacement.semantic_digest AS replacement_semantic_digest,
                replacement.transaction_data_digest AS replacement_data_digest,
                replacement.amount_base_unit::text AS replacement_amount,
                replacement.recipient AS replacement_recipient,
                replacement.gas_limit::text AS replacement_gas_limit,
                replacement.max_fee_per_gas_base_unit::text AS replacement_max_fee,
                replacement.max_priority_fee_per_gas_base_unit::text AS replacement_max_priority,
                (SELECT count(*)::text FROM local_helper_sweep_transactions all_tx
                  WHERE all_tx.operation_id = o.operation_id) AS transaction_count,
                (SELECT count(*)::text FROM local_helper_sweep_receipt_evidence evidence
                  WHERE evidence.operation_id = o.operation_id AND evidence.canonical
                    AND evidence.receipt_status = 'success') AS canonical_success_count
           FROM local_helper_sweep_operations o
           JOIN local_helper_sweep_batches batch ON batch.batch_id = o.batch_id
           JOIN custody_wallets w
             ON w.tenant_id = o.tenant_id AND w.user_id = o.user_id AND w.wallet_id = o.wallet_id
           JOIN wallet_nonce_ledgers ledger
             ON ledger.chain_id = o.chain_id AND ledger.wallet_id = o.wallet_id
           JOIN wallet_helper_deployment_bindings binding
             ON binding.binding_id = batch.helper_binding_id
           JOIN local_helper_residual_snapshots snapshot
             ON snapshot.tenant_id = o.tenant_id AND snapshot.user_id = o.user_id
            AND snapshot.wallet_id = o.wallet_id AND snapshot.snapshot_digest = o.snapshot_digest
           LEFT JOIN local_helper_sweep_transactions tx
             ON tx.transaction_id = o.active_transaction_id
           LEFT JOIN local_helper_sweep_replacement_authorizations replacement
             ON replacement.operation_id = o.operation_id AND replacement.state = 'pending'
          WHERE o.operation_id = $1 AND o.tenant_id = $2 AND o.user_id = $3`,
        [input.operationId, input.tenantId, input.userId],
      );
      const row = result.rows[0];
      if (
        !row ||
        !["queued", "broadcast", "pending", "dropped", "reconciling"].includes(
          row.operation_state,
        ) ||
        !["queued", "running"].includes(row.batch_state) ||
        row.batch_rescan_state !== "pending" ||
        row.plan_digest !== input.planDigest ||
        stable(row.plan_payload) !== stable(plan) ||
        row.asset_id !== plan.asset.assetId ||
        row.batch_snapshot_digest !== plan.snapshot.digest ||
        row.batch_registry_version !== this.#registry.registryVersion ||
        row.batch_registry_digest !== this.#registry.registryDigest ||
        row.wallet_address !== plan.wallet.address ||
        row.wallet_lifecycle_status !== "active" ||
        row.wallet_lock_status !== "ready" ||
        BigInt(row.ledger_fencing_token) < BigInt(plan.fencingToken) ||
        row.ledger_reconciliation_reason !== null ||
        row.binding_id !== plan.helper.bindingId ||
        row.binding_state !== "degraded" ||
        row.helper_address !== plan.helper.helperAddress ||
        row.owner_address !== plan.recipient ||
        row.adapter_address !== plan.helper.adapterAddress ||
        row.permit2_address !== plan.helper.permit2Address ||
        row.runtime_code_hash !== plan.helper.runtimeCodeHash ||
        row.snapshot_binding_state !== "degraded" ||
        row.snapshot_block_hash !== plan.snapshot.blockHash ||
        row.snapshot_block_number !== plan.snapshot.blockNumber ||
        !row.snapshot_coverage_complete ||
        row.snapshot_manual_recovery_required ||
        row.snapshot_registry_digest !== this.#registry.registryDigest ||
        row.canonical_success_count !== "0"
      ) {
        return false;
      }
      if (input.generation === 0) {
        if (
          row.operation_state !== "queued" ||
          row.active_generation !== null ||
          row.transaction_count !== "0" ||
          row.replacement_generation !== null
        ) {
          return false;
        }
      } else if (
        row.active_generation !== input.generation - 1 ||
        row.replacement_generation !== input.generation ||
        row.replacement_state !== "pending" ||
        !row.replacement_expires_at ||
        row.replacement_expires_at <= this.#now() ||
        row.replacement_plan_digest !== plan.planDigest ||
        row.replacement_semantic_digest !== plan.semanticDigest ||
        row.replacement_data_digest !== plan.transaction.dataDigest ||
        row.replacement_amount !== plan.asset.amountBaseUnit ||
        row.replacement_recipient !== plan.recipient ||
        row.replacement_gas_limit !== plan.feeLimit.gasLimit ||
        row.replacement_max_fee !== input.maxFeePerGasBaseUnit ||
        row.replacement_max_priority !== input.maxPriorityFeePerGasBaseUnit ||
        row.active_max_fee === null ||
        row.active_max_priority === null ||
        maxFee < BigInt(row.active_max_fee) ||
        priority < BigInt(row.active_max_priority) ||
        (maxFee === BigInt(row.active_max_fee) && priority === BigInt(row.active_max_priority))
      ) {
        return false;
      }
      const chain = await this.verifier.verify(plan);
      const snapshotBlock = BigInt(plan.snapshot.blockNumber);
      const head = BigInt(chain.headBlockNumber);
      if (
        chain.canonicalSnapshotBlockHash !== plan.snapshot.blockHash ||
        head < snapshotBlock ||
        head - snapshotBlock > BigInt(this.#registry.maxBlockDrift) ||
        chain.helper.runtimeCodeHash !== plan.helper.runtimeCodeHash ||
        chain.helper.owner !== plan.recipient ||
        chain.helper.adapter !== plan.helper.adapterAddress ||
        chain.helper.permit2 !== plan.helper.permit2Address ||
        chain.helper.executed ||
        chain.componentCode.length !== this.#registry.components.length ||
        chain.componentCode.some((component, index) => {
          const expected = this.#registry.components[index]!;
          return (
            component.address !== expected.address ||
            component.role !== expected.role ||
            component.runtimeCodeHash !== expected.runtimeCodeHash
          );
        }) ||
        chain.tokenCode.length !== this.#registry.tokens.length ||
        chain.tokenCode.some((token, index) => {
          const expected = this.#registry.tokens[index]!;
          return (
            token.address !== expected.address || token.runtimeCodeHash !== expected.runtimeCodeHash
          );
        })
      ) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }
}
