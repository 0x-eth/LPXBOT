import { LocalEvmRpcClient, type LocalEvmRpcClientOptions } from "@lpbot/chain-adapters";
import {
  buildWalletHelperV2DeploymentMaterial,
  P05_HELPER_DEPLOYMENT_REGISTRY,
  P05_LOCAL_HELPER_UPGRADE_REGISTRY,
  validateLocalHelperUpgradeRegistry,
  type LocalHelperUpgradeRegistry,
} from "@lpbot/chain-registry";
import {
  localHelperUpgradePlanDigest,
  localHelperUpgradeReplacementCandidate,
  localHelperUpgradeSelectorSetHash,
  validateLocalHelperUpgradePlan,
  validateLocalHelperUpgradeReplacement,
  type LocalHelperUpgradePlan,
} from "@lpbot/domain/local-helper-upgrade";
import type { Pool, QueryResultRow } from "pg";
import {
  decodeFunctionResult,
  encodeFunctionData,
  getContractAddress,
  keccak256,
  type Hex,
} from "viem";

import type { LocalHelperUpgradePlanAuthorizer } from "./custody-types.js";

const sourceReadAbi = [
  {
    inputs: [],
    name: "adapter",
    outputs: [{ type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "owner",
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
] as const;

interface RpcBlock {
  hash: Hex;
  number: Hex;
}

export interface LocalHelperUpgradePlanChainVerification {
  canonicalSnapshotBlockHash: Hex;
  componentCodeMatches: boolean;
  expectedTargetCode: Hex;
  headBlockNumber: string;
  latestNonce: string;
  pendingNonce: string;
  simulatedRuntimeCodeHash: Hex | null;
  source: {
    adapter: `0x${string}`;
    owner: `0x${string}`;
    permit2: `0x${string}`;
    runtimeCodeHash: Hex | null;
  };
  tokenCodeMatches: boolean;
}

export interface LocalHelperUpgradePlanChainVerifier {
  verify(plan: LocalHelperUpgradePlan): Promise<LocalHelperUpgradePlanChainVerification>;
}

function quantity(value: unknown): bigint {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/iu.test(value)) {
    throw new Error("LOCAL_HELPER_UPGRADE_SIGNER_QUANTITY_INVALID");
  }
  return BigInt(value);
}

function code(value: unknown): Hex {
  if (typeof value !== "string" || !/^0x(?:[0-9a-f]{2})*$/iu.test(value)) {
    throw new Error("LOCAL_HELPER_UPGRADE_SIGNER_CODE_INVALID");
  }
  return value.toLowerCase() as Hex;
}

function runtimeHash(value: Hex): Hex | null {
  return value === "0x" ? null : keccak256(value);
}

export class ViemLocalHelperUpgradePlanVerifier implements LocalHelperUpgradePlanChainVerifier {
  readonly #client: LocalEvmRpcClient;

  constructor(input: {
    chainId: 31_337;
    fetch?: typeof fetch;
    provider: Pick<LocalEvmRpcClientOptions, "providerId" | "rpcUrl">;
    registry?: LocalHelperUpgradeRegistry;
    timeoutMilliseconds?: number;
  }) {
    if (input.chainId !== 31_337) {
      throw new RangeError("LOCAL_HELPER_UPGRADE_SIGNER_CHAIN_INVALID");
    }
    validateLocalHelperUpgradeRegistry(input.registry ?? P05_LOCAL_HELPER_UPGRADE_REGISTRY);
    this.#client = new LocalEvmRpcClient({
      expectedChainId: 31_337,
      ...(input.fetch ? { fetch: input.fetch } : {}),
      ...input.provider,
      ...(input.timeoutMilliseconds ? { timeoutMilliseconds: input.timeoutMilliseconds } : {}),
    });
  }

  async verify(plan: LocalHelperUpgradePlan): Promise<LocalHelperUpgradePlanChainVerification> {
    const call = async (functionName: "adapter" | "owner" | "permit2") =>
      this.#client.request<Hex>("eth_call", [
        {
          data: encodeFunctionData({ abi: sourceReadAbi, functionName }),
          to: plan.source.helperAddress,
        },
        "latest",
      ]);
    const [
      snapshotBlock,
      head,
      latestNonce,
      pendingNonce,
      sourceCode,
      targetCode,
      simulatedRuntime,
      ownerRaw,
      adapterRaw,
      permit2Raw,
      componentCodes,
      tokenCodes,
    ] = await Promise.all([
      this.#client.request<RpcBlock | null>("eth_getBlockByNumber", [
        `0x${BigInt(plan.snapshot.blockNumber).toString(16)}`,
        false,
      ]),
      this.#client.request<Hex>("eth_blockNumber", []),
      this.#client.request<Hex>("eth_getTransactionCount", [plan.wallet.address, "latest"]),
      this.#client.request<Hex>("eth_getTransactionCount", [plan.wallet.address, "pending"]),
      this.#client.request<Hex>("eth_getCode", [plan.source.helperAddress, "latest"]),
      this.#client.request<Hex>("eth_getCode", [plan.target.expectedAddress, "latest"]),
      this.#client.request<Hex>("eth_call", [
        { data: plan.transaction.data, from: plan.wallet.address, value: "0x0" },
        "latest",
      ]),
      call("owner"),
      call("adapter"),
      call("permit2"),
      Promise.all(
        P05_HELPER_DEPLOYMENT_REGISTRY.components.map(({ address }) =>
          this.#client.request<Hex>("eth_getCode", [address, "latest"]),
        ),
      ),
      Promise.all(
        P05_HELPER_DEPLOYMENT_REGISTRY.tokens.map(({ address }) =>
          this.#client.request<Hex>("eth_getCode", [address, "latest"]),
        ),
      ),
    ]);
    if (!snapshotBlock) throw new Error("LOCAL_HELPER_UPGRADE_SIGNER_BLOCK_MISSING");
    const decoded = (name: "adapter" | "owner" | "permit2", data: Hex) =>
      decodeFunctionResult({
        abi: sourceReadAbi,
        data: code(data),
        functionName: name,
      }).toLowerCase() as `0x${string}`;
    return {
      canonicalSnapshotBlockHash: snapshotBlock.hash.toLowerCase() as Hex,
      componentCodeMatches: P05_HELPER_DEPLOYMENT_REGISTRY.components.every(
        (component, index) =>
          runtimeHash(code(componentCodes[index])) === component.runtimeCodeHash,
      ),
      expectedTargetCode: code(targetCode),
      headBlockNumber: quantity(head).toString(),
      latestNonce: quantity(latestNonce).toString(),
      pendingNonce: quantity(pendingNonce).toString(),
      simulatedRuntimeCodeHash: runtimeHash(code(simulatedRuntime)),
      source: {
        adapter: decoded("adapter", adapterRaw),
        owner: decoded("owner", ownerRaw),
        permit2: decoded("permit2", permit2Raw),
        runtimeCodeHash: runtimeHash(code(sourceCode)),
      },
      tokenCodeMatches: P05_HELPER_DEPLOYMENT_REGISTRY.tokens.every(
        (token, index) => runtimeHash(code(tokenCodes[index])) === token.runtimeCodeHash,
      ),
    };
  }
}

interface AuthorizationRow extends QueryResultRow {
  active_generation: number | null;
  active_max_fee: string | null;
  active_max_priority: string | null;
  active_state: string | null;
  active_transaction_id: string | null;
  ledger_fencing_token: string;
  ledger_next_nonce: string | null;
  ledger_reconciliation_reason: string | null;
  operation_cursor: string;
  operation_plan_digest: `sha256:${string}`;
  operation_plan_payload: LocalHelperUpgradePlan;
  operation_state: string;
  replacement_expires_at: Date | null;
  replacement_generation: number | null;
  replacement_init_code_hash: Hex | null;
  replacement_max_fee: string | null;
  replacement_max_priority: string | null;
  replacement_nonce: string | null;
  replacement_owner: `0x${string}` | null;
  replacement_plan_digest: `sha256:${string}` | null;
  replacement_state: string | null;
  replacement_target_address: `0x${string}` | null;
  replacement_target_version: string | null;
  source_adapter: `0x${string}`;
  source_helper: `0x${string}`;
  source_owner: `0x${string}`;
  source_permit2: `0x${string}`;
  source_registry: string;
  source_runtime: Hex;
  source_state: string;
  target_helper: `0x${string}`;
  target_runtime: Hex;
  target_state: string;
  transaction_count: string;
  wallet_address: `0x${string}`;
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

function initialFee(plan: LocalHelperUpgradePlan): {
  maxFeePerGasBaseUnit: string;
  maxPriorityFeePerGasBaseUnit: string;
} {
  const max = BigInt(plan.feeLimit.maxFeePerGasBaseUnit);
  const priority = BigInt(plan.feeLimit.maxPriorityFeePerGasBaseUnit);
  return {
    maxFeePerGasBaseUnit: (max > 1n ? max / 2n : max).toString(),
    maxPriorityFeePerGasBaseUnit: (priority > 1n ? priority / 2n : priority).toString(),
  };
}

export class PostgresLocalHelperUpgradePlanAuthorizer implements LocalHelperUpgradePlanAuthorizer {
  readonly #now: () => Date;
  readonly #registry: LocalHelperUpgradeRegistry;

  constructor(
    readonly pool: Pool,
    readonly verifier: LocalHelperUpgradePlanChainVerifier,
    input: { now?: () => Date; registry?: LocalHelperUpgradeRegistry } = {},
  ) {
    this.#now = input.now ?? (() => new Date());
    this.#registry = validateLocalHelperUpgradeRegistry(
      input.registry ?? P05_LOCAL_HELPER_UPGRADE_REGISTRY,
    );
  }

  async authorize(
    input: Parameters<LocalHelperUpgradePlanAuthorizer["authorize"]>[0],
  ): Promise<boolean> {
    try {
      const plan = input.plan;
      if (
        input.operationId !== plan.operationId ||
        input.planDigest !== plan.planDigest ||
        !Number.isSafeInteger(input.generation) ||
        input.generation < 0
      ) {
        return false;
      }
      const material = buildWalletHelperV2DeploymentMaterial(plan.wallet.address, this.#registry);
      const adapter = P05_HELPER_DEPLOYMENT_REGISTRY.components.find(
        ({ role }) => role === "adapter",
      )!;
      const permit2 = P05_HELPER_DEPLOYMENT_REGISTRY.components.find(
        ({ role }) => role === "permit2",
      )!;
      validateLocalHelperUpgradePlan(
        plan,
        {
          abiHash: this.#registry.target.abiHash,
          adapter: adapter.address,
          constructorArgumentsHash: material.constructorArgumentsHash,
          creationCodeHash: this.#registry.target.creationCodeHash,
          expectedAddress: getContractAddress({
            from: plan.wallet.address,
            nonce: BigInt(plan.nonce),
          }).toLowerCase() as `0x${string}`,
          expectedRuntimeCodeHash: plan.target.expectedRuntimeCodeHash,
          initCode: material.initCode,
          initCodeHash: material.initCodeHash,
          owner: plan.wallet.address,
          permit2: permit2.address,
          registryDigest: this.#registry.registryDigest,
          selectorSetHash: localHelperUpgradeSelectorSetHash(this.#registry.target.selectors),
          sourceBinding: {
            adapterAddress: adapter.address,
            bindingId: plan.source.bindingId,
            deploymentRegistryVersion: this.#registry.source.bindingRegistryVersion,
            helperAddress: plan.source.helperAddress,
            helperVersion: "WalletHelperV1",
            ownerAddress: plan.wallet.address,
            permit2Address: permit2.address,
            runtimeCodeHash: plan.source.runtimeCodeHash,
            state: "active",
            verifiedBlockNumber: plan.snapshot.blockNumber,
            walletId: plan.wallet.walletId,
          },
          tokenA: P05_HELPER_DEPLOYMENT_REGISTRY.tokens[0],
          tokenB: P05_HELPER_DEPLOYMENT_REGISTRY.tokens[1],
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
        priority > BigInt(plan.feeLimit.maxPriorityFeePerGasBaseUnit) ||
        BigInt(plan.feeLimit.gasLimit) * maxFee > BigInt(plan.feeLimit.feeCapBaseUnit)
      ) {
        return false;
      }
      const row = (
        await this.pool.query<AuthorizationRow>(
          `SELECT o.state AS operation_state, o.cursor AS operation_cursor,
                  o.plan_digest AS operation_plan_digest, o.plan_payload AS operation_plan_payload,
                  w.address_lower AS wallet_address, w.lifecycle_status AS wallet_lifecycle_status,
                  w.lock_status AS wallet_lock_status,
                  source.state AS source_state, source.helper_address AS source_helper,
                  source.owner_address AS source_owner, source.adapter_address AS source_adapter,
                  source.permit2_address AS source_permit2,
                  source.runtime_code_hash AS source_runtime,
                  source.registry_version AS source_registry,
                  target.state AS target_state, target.helper_address AS target_helper,
                  target.runtime_code_hash AS target_runtime,
                  ledger.next_nonce::text AS ledger_next_nonce,
                  ledger.fencing_token::text AS ledger_fencing_token,
                  ledger.reconciliation_reason AS ledger_reconciliation_reason,
                  active.transaction_id::text AS active_transaction_id,
                  active.generation AS active_generation, active.state AS active_state,
                  active.max_fee_per_gas_base_unit::text AS active_max_fee,
                  active.max_priority_fee_per_gas_base_unit::text AS active_max_priority,
                  replacement.generation AS replacement_generation,
                  replacement.state AS replacement_state,
                  replacement.expires_at AS replacement_expires_at,
                  replacement.plan_digest AS replacement_plan_digest,
                  replacement.init_code_hash AS replacement_init_code_hash,
                  replacement.target_version AS replacement_target_version,
                  replacement.nonce::text AS replacement_nonce,
                  replacement.owner_address AS replacement_owner,
                  replacement.target_helper_address AS replacement_target_address,
                  replacement.max_fee_per_gas_base_unit::text AS replacement_max_fee,
                  replacement.max_priority_fee_per_gas_base_unit::text AS replacement_max_priority,
                  (SELECT count(*)::text FROM local_helper_upgrade_transactions tx
                    WHERE tx.operation_id = o.operation_id) AS transaction_count
             FROM local_helper_upgrade_operations o
             JOIN custody_wallets w ON w.wallet_id = o.wallet_id
               AND w.tenant_id = o.tenant_id AND w.user_id = o.user_id
             JOIN wallet_helper_deployment_bindings source
               ON source.binding_id = o.source_binding_id
             JOIN wallet_helper_deployment_bindings target
               ON target.upgrade_operation_id = o.operation_id
             JOIN wallet_nonce_ledgers ledger
               ON ledger.chain_id = 31337 AND ledger.wallet_id = o.wallet_id
             LEFT JOIN local_helper_upgrade_transactions active
               ON active.transaction_id = o.active_transaction_id AND active.active
             LEFT JOIN local_helper_upgrade_replacement_authorizations replacement
               ON replacement.operation_id = o.operation_id AND replacement.generation = $5
            WHERE o.operation_id = $1 AND o.tenant_id = $2 AND o.user_id = $3
              AND o.wallet_id = $4`,
          [input.operationId, input.tenantId, input.userId, plan.wallet.walletId, input.generation],
        )
      ).rows[0];
      if (!row || !this.#databaseMatches(row, input)) return false;
      const chain = await this.verifier.verify(plan);
      const nonce = BigInt(plan.nonce);
      const latestNonce = BigInt(chain.latestNonce);
      const pendingNonce = BigInt(chain.pendingNonce);
      const targetRuntimeCodeHash = runtimeHash(chain.expectedTargetCode);
      const initialDeployment =
        targetRuntimeCodeHash === null && latestNonce === nonce && pendingNonce === nonce;
      const undurablePendingDeployment =
        targetRuntimeCodeHash === null && latestNonce === nonce && pendingNonce === nonce + 1n;
      const undurableConfirmedDeployment =
        targetRuntimeCodeHash === plan.target.expectedRuntimeCodeHash &&
        latestNonce === nonce + 1n &&
        pendingNonce === nonce + 1n;
      const deploymentStateMatches =
        input.generation === 0
          ? initialDeployment || undurablePendingDeployment || undurableConfirmedDeployment
          : initialDeployment || undurablePendingDeployment;
      return (
        chain.canonicalSnapshotBlockHash === plan.snapshot.blockHash &&
        BigInt(chain.headBlockNumber) >= BigInt(plan.snapshot.blockNumber) &&
        BigInt(chain.headBlockNumber) - BigInt(plan.snapshot.blockNumber) <=
          BigInt(this.#registry.maxBlockDrift) &&
        chain.simulatedRuntimeCodeHash === plan.target.expectedRuntimeCodeHash &&
        chain.source.owner === plan.wallet.address &&
        chain.source.adapter === plan.target.adapter &&
        chain.source.permit2 === plan.target.permit2 &&
        chain.source.runtimeCodeHash === plan.source.runtimeCodeHash &&
        chain.componentCodeMatches &&
        chain.tokenCodeMatches &&
        deploymentStateMatches
      );
    } catch {
      return false;
    }
  }

  #databaseMatches(
    row: AuthorizationRow,
    input: Parameters<LocalHelperUpgradePlanAuthorizer["authorize"]>[0],
  ): boolean {
    const plan = input.plan;
    if (
      row.operation_state !== "running" ||
      row.operation_cursor !== "deploy-v2" ||
      row.operation_plan_digest !== plan.planDigest ||
      stable(row.operation_plan_payload) !== stable(plan) ||
      row.wallet_address !== plan.wallet.address ||
      row.wallet_lifecycle_status !== "active" ||
      row.wallet_lock_status !== "ready" ||
      row.source_state !== "active" ||
      row.source_helper !== plan.source.helperAddress ||
      row.source_owner !== plan.wallet.address ||
      row.source_adapter !== plan.target.adapter ||
      row.source_permit2 !== plan.target.permit2 ||
      row.source_runtime !== plan.source.runtimeCodeHash ||
      row.source_registry !== this.#registry.source.bindingRegistryVersion ||
      row.target_state !== "deploying" ||
      row.target_helper !== plan.target.expectedAddress ||
      row.target_runtime !== plan.target.expectedRuntimeCodeHash ||
      row.ledger_reconciliation_reason !== null ||
      row.ledger_fencing_token !== plan.fencingToken ||
      row.ledger_next_nonce !== (BigInt(plan.nonce) + 1n).toString() ||
      localHelperUpgradePlanDigest(plan) !== plan.planDigest
    ) {
      return false;
    }
    if (input.generation === 0) {
      const fee = initialFee(plan);
      return (
        row.active_transaction_id === null &&
        row.transaction_count === "0" &&
        input.maxFeePerGasBaseUnit === fee.maxFeePerGasBaseUnit &&
        input.maxPriorityFeePerGasBaseUnit === fee.maxPriorityFeePerGasBaseUnit
      );
    }
    if (
      row.active_transaction_id === null ||
      row.active_generation === null ||
      !["broadcast", "pending", "dropped"].includes(row.active_state ?? "") ||
      row.active_max_fee === null ||
      row.active_max_priority === null ||
      row.replacement_generation !== input.generation ||
      row.replacement_state !== "pending" ||
      !row.replacement_expires_at ||
      row.replacement_expires_at <= this.#now() ||
      row.replacement_plan_digest !== plan.planDigest ||
      row.replacement_init_code_hash !== plan.transaction.dataHash ||
      row.replacement_target_version !== plan.target.helperVersion ||
      row.replacement_nonce !== plan.nonce ||
      row.replacement_owner !== plan.target.owner ||
      row.replacement_target_address !== plan.target.expectedAddress ||
      row.replacement_max_fee !== input.maxFeePerGasBaseUnit ||
      row.replacement_max_priority !== input.maxPriorityFeePerGasBaseUnit ||
      input.generation !== row.active_generation + 1
    ) {
      return false;
    }
    validateLocalHelperUpgradeReplacement(
      plan,
      localHelperUpgradeReplacementCandidate(plan, {
        maxFeePerGasBaseUnit: row.active_max_fee,
        maxPriorityFeePerGasBaseUnit: row.active_max_priority,
      }),
      localHelperUpgradeReplacementCandidate(plan, {
        maxFeePerGasBaseUnit: input.maxFeePerGasBaseUnit,
        maxPriorityFeePerGasBaseUnit: input.maxPriorityFeePerGasBaseUnit,
      }),
    );
    return true;
  }
}
