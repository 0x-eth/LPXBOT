import { LocalEvmRpcClient, type LocalEvmRpcClientOptions } from "@lpbot/chain-adapters";
import {
  localSwapComponent,
  P05_LOCAL_SWAP_EXECUTION_REGISTRY,
  validateLocalSwapExecutionRegistry,
  type LocalSwapExecutionRegistry,
} from "@lpbot/chain-registry";
import {
  localSwapExecutionPlanDigest,
  localSwapPermit2AuthorizationDigest,
  type LocalSwapExecutionPlan,
  type LocalSwapPermit2SigningPayload,
  type LocalSwapPlanStep,
} from "@lpbot/domain/local-swap-execution";
import type { Pool } from "pg";
import {
  decodeFunctionResult,
  encodeFunctionData,
  keccak256,
  type Address,
  type Hex,
} from "viem";

import type {
  LocalSwapPermit2Authorizer,
  LocalSwapStepPlanAuthorizer,
} from "./custody-types.js";

const helperReadAbi = [
  { inputs: [], name: "owner", outputs: [{ type: "address" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "adapter", outputs: [{ type: "address" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "permit2", outputs: [{ type: "address" }], stateMutability: "view", type: "function" },
  { inputs: [{ type: "bytes32" }], name: "executedPlans", outputs: [{ type: "bool" }], stateMutability: "view", type: "function" },
] as const;

const permit2ReadAbi = [
  { inputs: [], name: "DOMAIN_SEPARATOR", outputs: [{ type: "bytes32" }], stateMutability: "view", type: "function" },
  {
    inputs: [{ name: "user", type: "address" }, { name: "token", type: "address" }, { name: "spender", type: "address" }],
    name: "allowance",
    outputs: [{ name: "amount", type: "uint160" }, { name: "expiration", type: "uint48" }, { name: "nonce", type: "uint48" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

export interface LocalSwapStepChainVerification {
  blockNumber: string;
  componentCode: readonly { address: Address; role: "adapter" | "permit2" | "router"; runtimeCodeHash: Hex | null }[];
  helper: { adapter: Address; codeHash: Hex | null; executed: boolean; owner: Address; permit2: Address };
  tokenCode: readonly { address: Address; runtimeCodeHash: Hex | null }[];
}

export interface LocalSwapPermit2ChainVerification {
  blockTimestamp: string;
  domainSeparator: Hex;
  nonce: string;
  permit2CodeHash: Hex | null;
  tokenCodeHash: Hex | null;
}

export interface LocalSwapPlanChainVerifier {
  verifyPermit2(input: {
    owner: Address;
    payload: LocalSwapPermit2SigningPayload;
  }): Promise<LocalSwapPermit2ChainVerification>;
  verifyStep(plan: LocalSwapExecutionPlan, step: LocalSwapPlanStep): Promise<LocalSwapStepChainVerification>;
}

function quantity(value: unknown): bigint {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/iu.test(value)) {
    throw new Error("LOCAL_SWAP_SIGNER_QUANTITY_INVALID");
  }
  return BigInt(value);
}

function bytecode(value: unknown): Hex {
  if (typeof value !== "string" || !/^0x(?:[0-9a-f]{2})*$/iu.test(value)) {
    throw new Error("LOCAL_SWAP_SIGNER_CODE_INVALID");
  }
  return value.toLowerCase() as Hex;
}

function codeHash(value: Hex): Hex | null {
  return value === "0x" ? null : keccak256(value);
}

export class ViemLocalSwapPlanVerifier implements LocalSwapPlanChainVerifier {
  readonly #client: LocalEvmRpcClient;
  readonly #registry: LocalSwapExecutionRegistry;

  constructor(input: {
    chainId: 31_337;
    fetch?: typeof fetch;
    provider: Pick<LocalEvmRpcClientOptions, "providerId" | "rpcUrl">;
    registry?: LocalSwapExecutionRegistry;
    timeoutMilliseconds?: number;
  }) {
    if (input.chainId !== 31_337) throw new RangeError("LOCAL_SWAP_SIGNER_CHAIN_INVALID");
    this.#registry = validateLocalSwapExecutionRegistry(
      input.registry ?? P05_LOCAL_SWAP_EXECUTION_REGISTRY,
    );
    this.#client = new LocalEvmRpcClient({
      expectedChainId: 31_337,
      ...(input.fetch ? { fetch: input.fetch } : {}),
      ...input.provider,
      ...(input.timeoutMilliseconds ? { timeoutMilliseconds: input.timeoutMilliseconds } : {}),
    });
  }

  async verifyStep(plan: LocalSwapExecutionPlan): Promise<LocalSwapStepChainVerification> {
    const calls = (name: "adapter" | "executedPlans" | "owner" | "permit2", args: readonly unknown[] = []) =>
      this.#client.request<Hex>("eth_call", [
        {
          data: encodeFunctionData({
            abi: helperReadAbi,
            args: args as never,
            functionName: name,
          }),
          to: plan.helper.address,
        },
        "latest",
      ]);
    const [blockNumber, helperCode, ownerRaw, adapterRaw, permit2Raw, executedRaw, components, tokens] =
      await Promise.all([
        this.#client.request<Hex>("eth_blockNumber", []),
        this.#client.request<Hex>("eth_getCode", [plan.helper.address, "latest"]),
        calls("owner"),
        calls("adapter"),
        calls("permit2"),
        calls("executedPlans", [plan.helperPlanDigest]),
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
    return {
      blockNumber: quantity(blockNumber).toString(),
      componentCode: this.#registry.components.map(({ address, role }, index) => ({
        address,
        role,
        runtimeCodeHash: codeHash(bytecode(components[index])),
      })),
      helper: {
        adapter: decodeFunctionResult({ abi: helperReadAbi, data: adapterRaw, functionName: "adapter" }).toLowerCase() as Address,
        codeHash: codeHash(bytecode(helperCode)),
        executed: decodeFunctionResult({ abi: helperReadAbi, data: executedRaw, functionName: "executedPlans" }),
        owner: decodeFunctionResult({ abi: helperReadAbi, data: ownerRaw, functionName: "owner" }).toLowerCase() as Address,
        permit2: decodeFunctionResult({ abi: helperReadAbi, data: permit2Raw, functionName: "permit2" }).toLowerCase() as Address,
      },
      tokenCode: this.#registry.tokens.map(({ address }, index) => ({
        address,
        runtimeCodeHash: codeHash(bytecode(tokens[index])),
      })),
    };
  }

  async verifyPermit2(input: { owner: Address; payload: LocalSwapPermit2SigningPayload }) {
    const permit2 = input.payload.permit2;
    const [block, permit2Code, tokenCode, domainRaw, allowanceRaw] = await Promise.all([
      this.#client.request<{ timestamp: Hex }>("eth_getBlockByNumber", ["latest", false]),
      this.#client.request<Hex>("eth_getCode", [permit2, "latest"]),
      this.#client.request<Hex>("eth_getCode", [input.payload.token, "latest"]),
      this.#client.request<Hex>("eth_call", [
        { data: encodeFunctionData({ abi: permit2ReadAbi, functionName: "DOMAIN_SEPARATOR" }), to: permit2 },
        "latest",
      ]),
      this.#client.request<Hex>("eth_call", [
        {
          data: encodeFunctionData({
            abi: permit2ReadAbi,
            args: [input.owner, input.payload.token, input.payload.spender],
            functionName: "allowance",
          }),
          to: permit2,
        },
        "latest",
      ]),
    ]);
    const [, , nonce] = decodeFunctionResult({ abi: permit2ReadAbi, data: allowanceRaw, functionName: "allowance" });
    return {
      blockTimestamp: quantity(block.timestamp).toString(),
      domainSeparator: decodeFunctionResult({ abi: permit2ReadAbi, data: domainRaw, functionName: "DOMAIN_SEPARATOR" }),
      nonce: nonce.toString(),
      permit2CodeHash: codeHash(bytecode(permit2Code)),
      tokenCodeHash: codeHash(bytecode(tokenCode)),
    };
  }
}

export class PostgresLocalSwapStepPlanAuthorizer implements LocalSwapStepPlanAuthorizer {
  readonly #now: () => Date;
  readonly #registry: LocalSwapExecutionRegistry;

  constructor(
    readonly pool: Pool,
    readonly chain: LocalSwapPlanChainVerifier,
    input: { now?: () => Date; registry?: LocalSwapExecutionRegistry } = {},
  ) {
    this.#now = input.now ?? (() => new Date());
    this.#registry = validateLocalSwapExecutionRegistry(
      input.registry ?? P05_LOCAL_SWAP_EXECUTION_REGISTRY,
    );
  }

  async authorize(input: Parameters<LocalSwapStepPlanAuthorizer["authorize"]>[0]): Promise<boolean> {
    const plan = input.plan;
    const step = plan.steps.find(({ stepId }) => stepId === input.stepId);
    if (!step || !this.#validPlan(plan, input.planDigest) || !this.#validFee(step, input)) return false;
    const result = await this.pool.query<{ authorized: boolean }>(
      `SELECT true AS authorized
         FROM local_swap_operations o
         JOIN local_swap_operation_steps s ON s.operation_id = o.operation_id
         JOIN custody_wallets w
           ON w.tenant_id = o.tenant_id AND w.user_id = o.user_id AND w.wallet_id = o.wallet_id
         JOIN wallet_nonce_ledgers l ON l.chain_id = o.chain_id AND l.wallet_id = o.wallet_id
         JOIN wallet_helper_deployment_bindings b ON b.binding_id = o.helper_binding_id
        WHERE o.operation_id = $1 AND o.tenant_id = $2 AND o.user_id = $3
          AND o.wallet_id = $4 AND o.wallet_address = $5
          AND o.chain_id = 31337 AND o.operation_kind = 'local-swap'
          AND o.registry_version = $6 AND o.registry_digest = $7
          AND o.plan_digest = $8 AND o.plan_payload = $9::jsonb
          AND o.plan_deadline > clock_timestamp()
          AND s.step_id = $10 AND s.ordinal = $11 AND s.step_kind = $12
          AND s.nonce = $13 AND s.fencing_token = $14
          AND l.fencing_token >= s.fencing_token AND l.reconciliation_reason IS NULL
          AND s.semantic_digest = $15 AND s.transaction_to = $16
          AND s.transaction_data = $17 AND s.transaction_data_digest = $18
          AND s.transaction_value_base_unit = 0
          AND s.gas_limit = $19
          AND $20::numeric <= s.max_fee_per_gas_base_unit
          AND $21::numeric <= s.max_priority_fee_per_gas_base_unit
          AND w.address_lower = $5 AND w.lifecycle_status = 'active' AND w.lock_status = 'ready'
          AND b.state = 'active' AND b.helper_address = $22 AND b.owner_address = $5
          AND b.adapter_address = $23 AND b.permit2_address = $24
          AND b.runtime_code_hash = $25 AND b.registry_version = 'p05-local-helper-deployment-v2'
          AND (
            ($26 = 0 AND s.state = 'queued' AND s.active_transaction_id IS NULL
              AND NOT EXISTS (SELECT 1 FROM local_swap_step_transactions t WHERE t.step_id = s.step_id))
            OR
            ($26 > 0 AND s.state IN ('broadcast', 'pending', 'dropped')
              AND EXISTS (
                SELECT 1
                  FROM local_swap_step_transactions t
                  JOIN local_swap_replacement_authorizations r
                    ON r.replaced_transaction_id = t.transaction_id
                   AND r.step_id = s.step_id AND r.generation = $26
                 WHERE t.step_id = s.step_id AND t.active
                   AND r.state = 'pending' AND r.expires_at > clock_timestamp()
                   AND r.plan_digest = $8 AND r.semantic_digest = $15
                   AND r.transaction_to = $16 AND r.transaction_data_digest = $18
                   AND r.nonce = $13
                   AND r.max_fee_per_gas_base_unit = $20
                   AND r.max_priority_fee_per_gas_base_unit = $21
                   AND r.max_fee_per_gas_base_unit >= t.max_fee_per_gas_base_unit
                   AND r.max_priority_fee_per_gas_base_unit >= t.max_priority_fee_per_gas_base_unit
                   AND (r.max_fee_per_gas_base_unit > t.max_fee_per_gas_base_unit
                     OR r.max_priority_fee_per_gas_base_unit > t.max_priority_fee_per_gas_base_unit)
              ))
          )`,
      [
        plan.operationId,
        input.tenantId,
        input.userId,
        plan.wallet.walletId,
        plan.wallet.address,
        plan.registry.version,
        plan.registry.digest,
        input.planDigest,
        JSON.stringify(plan),
        step.stepId,
        step.ordinal,
        step.kind,
        step.nonce,
        step.fencingToken,
        step.semanticDigest,
        step.transaction.to,
        step.transaction.data,
        step.transaction.dataDigest,
        step.feeLimit.gasLimit,
        input.maxFeePerGasBaseUnit,
        input.maxPriorityFeePerGasBaseUnit,
        plan.helper.address,
        plan.helper.adapter,
        plan.helper.permit2,
        plan.helper.runtimeCodeHash,
        input.generation,
      ],
    );
    if (result.rows[0]?.authorized !== true) return false;
    try {
      const verification = await this.chain.verifyStep(plan, step);
      if (
        verification.helper.codeHash !== plan.helper.runtimeCodeHash ||
        verification.helper.owner !== plan.wallet.address ||
        verification.helper.adapter !== plan.helper.adapter ||
        verification.helper.permit2 !== plan.helper.permit2 ||
        (step.kind === "swap" && verification.helper.executed) ||
        BigInt(verification.blockNumber) > BigInt(plan.quote.maxBlockNumber)
      ) return false;
      return this.#registry.components.every((expected) => {
        const actual = verification.componentCode.find(({ role }) => role === expected.role);
        return actual?.address === expected.address && actual.runtimeCodeHash === expected.runtimeCodeHash;
      }) && this.#registry.tokens.every((expected) => {
        const actual = verification.tokenCode.find(({ address }) => address === expected.address);
        return actual?.runtimeCodeHash === expected.runtimeCodeHash;
      });
    } catch {
      return false;
    }
  }

  #validPlan(plan: LocalSwapExecutionPlan, digest: `sha256:${string}`): boolean {
    return (
      plan.chainId === 31_337 &&
      plan.planDigest === digest &&
      localSwapExecutionPlanDigest(plan) === digest &&
      plan.deadline > this.#now().toISOString() &&
      plan.quote.expiresAt > this.#now().toISOString() &&
      plan.registry.version === this.#registry.registryVersion &&
      plan.registry.digest === this.#registry.registryDigest &&
      plan.registry.rollbackVersion === this.#registry.rollbackVersion &&
      plan.serviceFeeBps === 0 &&
      plan.helper.owner === plan.wallet.address &&
      plan.helper.adapter === localSwapComponent("adapter", this.#registry).address &&
      plan.helper.permit2 === localSwapComponent("permit2", this.#registry).address &&
      this.#registry.tokens.some(({ address }) => address === plan.quote.tokenIn) &&
      this.#registry.tokens.some(({ address }) => address === plan.quote.tokenOut)
    );
  }

  #validFee(
    step: LocalSwapPlanStep,
    input: Pick<Parameters<LocalSwapStepPlanAuthorizer["authorize"]>[0], "generation" | "maxFeePerGasBaseUnit" | "maxPriorityFeePerGasBaseUnit">,
  ): boolean {
    if (
      !Number.isSafeInteger(input.generation) || input.generation < 0 ||
      !/^[1-9][0-9]*$/u.test(input.maxFeePerGasBaseUnit) ||
      !/^(?:0|[1-9][0-9]*)$/u.test(input.maxPriorityFeePerGasBaseUnit)
    ) return false;
    const max = BigInt(input.maxFeePerGasBaseUnit);
    const priority = BigInt(input.maxPriorityFeePerGasBaseUnit);
    return max <= BigInt(step.feeLimit.maxFeePerGasBaseUnit) &&
      priority <= BigInt(step.feeLimit.maxPriorityFeePerGasBaseUnit) && priority <= max;
  }
}

export class PostgresLocalSwapPermit2Authorizer implements LocalSwapPermit2Authorizer {
  readonly #now: () => Date;
  readonly #registry: LocalSwapExecutionRegistry;

  constructor(
    readonly pool: Pool,
    readonly chain: LocalSwapPlanChainVerifier,
    input: { now?: () => Date; registry?: LocalSwapExecutionRegistry } = {},
  ) {
    this.#now = input.now ?? (() => new Date());
    this.#registry = validateLocalSwapExecutionRegistry(
      input.registry ?? P05_LOCAL_SWAP_EXECUTION_REGISTRY,
    );
  }

  async authorize(input: Parameters<LocalSwapPermit2Authorizer["authorize"]>[0]): Promise<boolean> {
    const payload = input.payload;
    try { localSwapPermit2AuthorizationDigest(payload); } catch { return false; }
    const nowSeconds = BigInt(Math.floor(this.#now().getTime() / 1_000));
    if (
      payload.permit2 !== localSwapComponent("permit2", this.#registry).address ||
      !this.#registry.tokens.some(({ address }) => address === payload.token) ||
      BigInt(payload.expiration) <= nowSeconds ||
      BigInt(payload.expiration) > nowSeconds + BigInt(this.#registry.maxPermit2ExpirationSeconds) ||
      BigInt(payload.sigDeadline) < BigInt(payload.expiration)
    ) return false;
    const result = await this.pool.query<{ owner_address: Address }>(
      `SELECT w.address_lower AS owner_address
         FROM local_swap_quote_snapshots q
         JOIN custody_wallets w
           ON w.tenant_id = q.tenant_id AND w.user_id = q.user_id AND w.wallet_id = q.wallet_id
         JOIN wallet_helper_deployment_bindings b
           ON b.tenant_id = q.tenant_id AND b.user_id = q.user_id AND b.wallet_id = q.wallet_id
        WHERE q.tenant_id = $1 AND q.user_id = $2 AND q.wallet_id = $3
          AND q.quote_digest = $4 AND q.chain_id = 31337
          AND q.execution_enabled AND q.expires_at > clock_timestamp()
          AND q.registry_version = $5 AND q.registry_digest = $6
          AND q.token_in = $7 AND q.amount_in_base_unit = $8
          AND q.deadline >= to_timestamp($9::numeric)
          AND w.lifecycle_status = 'active' AND w.lock_status = 'ready'
          AND b.chain_id = 31337 AND b.state = 'active'
          AND b.helper_address = $10 AND b.owner_address = w.address_lower
          AND b.permit2_address = $11 AND b.adapter_address = $12
          AND b.registry_version = 'p05-local-helper-deployment-v2'`,
      [
        input.tenantId,
        input.userId,
        payload.walletId,
        payload.quoteDigest,
        this.#registry.registryVersion,
        this.#registry.registryDigest,
        payload.token,
        payload.amountBaseUnit,
        payload.sigDeadline,
        payload.spender,
        payload.permit2,
        localSwapComponent("adapter", this.#registry).address,
      ],
    );
    const owner = result.rows[0]?.owner_address;
    if (!owner) return false;
    try {
      const verification = await this.chain.verifyPermit2({ owner, payload });
      return verification.domainSeparator === payload.domainSeparator &&
        verification.nonce === payload.nonce &&
        verification.permit2CodeHash === localSwapComponent("permit2", this.#registry).runtimeCodeHash &&
        verification.tokenCodeHash === this.#registry.tokens.find(({ address }) => address === payload.token)?.runtimeCodeHash &&
        BigInt(verification.blockTimestamp) <= BigInt(payload.expiration);
    } catch {
      return false;
    }
  }
}
