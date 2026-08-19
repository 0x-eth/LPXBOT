import { LocalEvmRpcClient, type LocalEvmRpcClientOptions } from "@lpbot/chain-adapters";
import {
  P05_LOCAL_POSITION_EXECUTION_REGISTRY,
  validateLocalPositionExecutionRegistry,
  type LocalPositionExecutionRegistry,
} from "@lpbot/chain-registry";
import {
  localPositionExecutionPlanDigest,
  validateLocalPositionExecutionPlan,
  type LocalPositionExecutionPlan,
  type LocalPositionPlanStep,
} from "@lpbot/domain/local-position-execution";
import type { Pool } from "pg";
import {
  decodeFunctionData,
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  keccak256,
  toHex,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";

import type { LocalPositionStepPlanAuthorizer } from "./custody-types.js";

const managerAbi = [
  {
    inputs: [{ name: "tokenId", type: "uint256" }],
    name: "ownerOf",
    outputs: [{ name: "owner", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "tokenId", type: "uint256" }],
    name: "getApproved",
    outputs: [{ name: "operator", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "owner", type: "address" },
      { name: "operator", type: "address" },
    ],
    name: "isApprovedForAll",
    outputs: [{ name: "approved", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "tokenId", type: "uint256" }],
    name: "positions",
    outputs: [
      {
        components: [
          { name: "platformId", type: "uint8" },
          { name: "token0", type: "address" },
          { name: "token1", type: "address" },
          { name: "poolAddress", type: "address" },
          { name: "poolId", type: "bytes32" },
          { name: "tickLower", type: "int24" },
          { name: "tickUpper", type: "int24" },
          { name: "tickSpacing", type: "int24" },
          { name: "feePips", type: "uint24" },
          { name: "liquidity", type: "uint128" },
          { name: "reserve0", type: "uint128" },
          { name: "reserve1", type: "uint128" },
          { name: "tokensOwed0", type: "uint128" },
          { name: "tokensOwed1", type: "uint128" },
        ],
        name: "",
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        components: [
          { name: "tokenId", type: "uint256" },
          { name: "recipient", type: "address" },
          { name: "amount0Max", type: "uint128" },
          { name: "amount1Max", type: "uint128" },
        ],
        name: "params",
        type: "tuple",
      },
    ],
    name: "collect",
    outputs: [
      { name: "amount0", type: "uint256" },
      { name: "amount1", type: "uint256" },
    ],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        components: [
          { name: "tokenId", type: "uint256" },
          { name: "liquidity", type: "uint128" },
          { name: "amount0Min", type: "uint256" },
          { name: "amount1Min", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
        name: "params",
        type: "tuple",
      },
    ],
    name: "decreaseLiquidity",
    outputs: [
      { name: "amount0", type: "uint256" },
      { name: "amount1", type: "uint256" },
    ],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "tokenId", type: "uint256" }],
    name: "burn",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

export interface LocalPositionStepChainVerification {
  canonicalSnapshotBlockHash: Hex;
  headBlockNumber: string;
  managerCodeHash: Hex | null;
  owner: Address;
  approvedAddress: Address | null;
  approvedForAll: boolean;
  position: {
    feePips: string;
    liquidity: string;
    platformId: 1 | 2 | 4 | 5;
    poolAddress: Address | null;
    poolId: Hex | null;
    reserve0BaseUnit: string;
    reserve1BaseUnit: string;
    tickLower: string;
    tickSpacing: string;
    tickUpper: string;
    token0: Address;
    token1: Address;
    tokensOwed0BaseUnit: string;
    tokensOwed1BaseUnit: string;
  };
  tokenCode: readonly { address: Address; runtimeCodeHash: Hex | null }[];
}

export interface LocalPositionPlanChainVerifier {
  verifyStep(
    plan: LocalPositionExecutionPlan,
    step: LocalPositionPlanStep,
  ): Promise<LocalPositionStepChainVerification>;
}

interface RpcBlock {
  hash: Hex;
}

function quantity(value: unknown): bigint {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/iu.test(value)) {
    throw new Error("LOCAL_POSITION_SIGNER_QUANTITY_INVALID");
  }
  return BigInt(value);
}

function bytecode(value: unknown): Hex {
  if (typeof value !== "string" || !/^0x(?:[0-9a-f]{2})*$/iu.test(value)) {
    throw new Error("LOCAL_POSITION_SIGNER_CODE_INVALID");
  }
  return value.toLowerCase() as Hex;
}

function codeHash(value: Hex): Hex | null {
  return value === "0x" ? null : keccak256(value);
}

export class ViemLocalPositionPlanVerifier implements LocalPositionPlanChainVerifier {
  readonly #client: LocalEvmRpcClient;

  constructor(input: {
    chainId: 31_337;
    fetch?: typeof fetch;
    provider: Pick<LocalEvmRpcClientOptions, "providerId" | "rpcUrl">;
    registry?: LocalPositionExecutionRegistry;
    timeoutMilliseconds?: number;
  }) {
    if (input.chainId !== 31_337) throw new RangeError("LOCAL_POSITION_SIGNER_CHAIN_INVALID");
    validateLocalPositionExecutionRegistry(input.registry ?? P05_LOCAL_POSITION_EXECUTION_REGISTRY);
    this.#client = new LocalEvmRpcClient({
      expectedChainId: 31_337,
      ...(input.fetch ? { fetch: input.fetch } : {}),
      ...input.provider,
      ...(input.timeoutMilliseconds ? { timeoutMilliseconds: input.timeoutMilliseconds } : {}),
    });
  }

  async verifyStep(
    plan: LocalPositionExecutionPlan,
  ): Promise<LocalPositionStepChainVerification> {
    const tokenId = BigInt(plan.snapshot.position.tokenId);
    const call = (functionName: "getApproved" | "ownerOf" | "positions", args: readonly unknown[]) =>
      this.#client.request<Hex>("eth_call", [
        {
          data: encodeFunctionData({
            abi: managerAbi,
            args: args as never,
            functionName,
          }),
          to: plan.manager.address,
        },
        "latest",
      ]);
    const approvalOperator = plan.snapshot.position.approval.operator;
    const approvalForAll = approvalOperator
      ? this.#client.request<Hex>("eth_call", [
          {
            data: encodeFunctionData({
              abi: managerAbi,
              args: [getAddress(plan.wallet.address), getAddress(approvalOperator)],
              functionName: "isApprovedForAll",
            }),
            to: plan.manager.address,
          },
          "latest",
        ])
      : Promise.resolve<Hex | null>(null);
    const [
      canonicalBlock,
      head,
      managerCode,
      tokenCodes,
      ownerRaw,
      approvedRaw,
      approvedForAllRaw,
      positionRaw,
    ] = await Promise.all([
      this.#client.request<RpcBlock | null>("eth_getBlockByNumber", [
        toHex(BigInt(plan.snapshot.block.number)),
        false,
      ]),
      this.#client.request<Hex>("eth_blockNumber", []),
      this.#client.request<Hex>("eth_getCode", [plan.manager.address, "latest"]),
      Promise.all(
        plan.snapshot.tokens.map(({ address }) =>
          this.#client.request<Hex>("eth_getCode", [address, "latest"]),
        ),
      ),
      call("ownerOf", [tokenId]),
      call("getApproved", [tokenId]),
      approvalForAll,
      call("positions", [tokenId]),
    ]);
    if (!canonicalBlock) throw new Error("LOCAL_POSITION_SIGNER_BLOCK_MISSING");
    const owner = decodeFunctionResult({ abi: managerAbi, data: ownerRaw, functionName: "ownerOf" });
    const approved = decodeFunctionResult({
      abi: managerAbi,
      data: approvedRaw,
      functionName: "getApproved",
    });
    const position = decodeFunctionResult({
      abi: managerAbi,
      data: positionRaw,
      functionName: "positions",
    });
    const v3 = position.platformId === 1 || position.platformId === 2;
    return {
      approvedAddress:
        approved.toLowerCase() === zeroAddress ? null : (approved.toLowerCase() as Address),
      approvedForAll: approvedForAllRaw
        ? decodeFunctionResult({
            abi: managerAbi,
            data: approvedForAllRaw,
            functionName: "isApprovedForAll",
          })
        : false,
      canonicalSnapshotBlockHash: canonicalBlock.hash.toLowerCase() as Hex,
      headBlockNumber: quantity(head).toString(),
      managerCodeHash: codeHash(bytecode(managerCode)),
      owner: owner.toLowerCase() as Address,
      position: {
        feePips: position.feePips.toString(),
        liquidity: position.liquidity.toString(),
        platformId: position.platformId as 1 | 2 | 4 | 5,
        poolAddress: v3 ? (position.poolAddress.toLowerCase() as Address) : null,
        poolId: v3 ? null : (position.poolId.toLowerCase() as Hex),
        reserve0BaseUnit: position.reserve0.toString(),
        reserve1BaseUnit: position.reserve1.toString(),
        tickLower: position.tickLower.toString(),
        tickSpacing: position.tickSpacing.toString(),
        tickUpper: position.tickUpper.toString(),
        token0: position.token0.toLowerCase() as Address,
        token1: position.token1.toLowerCase() as Address,
        tokensOwed0BaseUnit: position.tokensOwed0.toString(),
        tokensOwed1BaseUnit: position.tokensOwed1.toString(),
      },
      tokenCode: plan.snapshot.tokens.map(({ address }, index) => ({
        address,
        runtimeCodeHash: codeHash(bytecode(tokenCodes[index])),
      })),
    };
  }
}

interface AuthorizationRow {
  active_generation: number | null;
  active_max_fee: string | null;
  active_max_priority: string | null;
  operation_state: string;
  plan_digest: `sha256:${string}`;
  plan_payload: LocalPositionExecutionPlan;
  replacement_generation: number | null;
  replacement_max_fee: string | null;
  replacement_max_priority: string | null;
  replacement_state: string | null;
  step_data: Hex;
  step_data_digest: `sha256:${string}`;
  step_fencing_token: string;
  step_kind: LocalPositionPlanStep["kind"];
  step_nonce: string;
  step_ordinal: number;
  step_semantic_digest: `sha256:${string}`;
  step_state: string;
  step_to: Address;
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

function calldataMatches(plan: LocalPositionExecutionPlan, step: LocalPositionPlanStep): boolean {
  try {
    const decoded = decodeFunctionData({ abi: managerAbi, data: step.transaction.data });
    const tokenId = BigInt(plan.snapshot.position.tokenId);
    if (step.kind === "burn") {
      return decoded.functionName === "burn" && decoded.args[0] === tokenId;
    }
    if (step.kind === "collect") {
      if (decoded.functionName !== "collect") return false;
      const params = decoded.args[0] as {
        amount0Max: bigint;
        amount1Max: bigint;
        recipient: Address;
        tokenId: bigint;
      };
      return (
        params.tokenId === tokenId &&
        params.recipient.toLowerCase() === plan.wallet.address &&
        params.amount0Max === BigInt(plan.accounting.collectTotal0BaseUnit) &&
        params.amount1Max === BigInt(plan.accounting.collectTotal1BaseUnit)
      );
    }
    if (decoded.functionName !== "decreaseLiquidity") return false;
    const params = decoded.args[0] as {
      amount0Min: bigint;
      amount1Min: bigint;
      deadline: bigint;
      liquidity: bigint;
      tokenId: bigint;
    };
    return (
      params.tokenId === tokenId &&
      params.liquidity === BigInt(plan.accounting.liquidityDelta) &&
      params.amount0Min === BigInt(plan.accounting.minPrincipal0BaseUnit) &&
      params.amount1Min === BigInt(plan.accounting.minPrincipal1BaseUnit) &&
      params.deadline === BigInt(Math.floor(Date.parse(plan.deadline) / 1_000))
    );
  } catch {
    return false;
  }
}

function expectedPosition(plan: LocalPositionExecutionPlan, step: LocalPositionPlanStep) {
  const snapshot = plan.snapshot.position;
  const base = {
    feePips: snapshot.pool.feePips,
    platformId: snapshot.platformId,
    poolAddress: snapshot.pool.poolAddress,
    poolId: snapshot.pool.poolId,
    tickLower: snapshot.ticks.lower,
    tickSpacing: snapshot.pool.tickSpacing,
    tickUpper: snapshot.ticks.upper,
    token0: snapshot.pool.token0,
    token1: snapshot.pool.token1,
  };
  if (step.kind === "decrease" || plan.action.kind === "collect-fees") {
    return {
      ...base,
      liquidity: snapshot.liquidity,
      reserve0BaseUnit: snapshot.reserve0BaseUnit,
      reserve1BaseUnit: snapshot.reserve1BaseUnit,
      tokensOwed0BaseUnit: snapshot.tokensOwed0BaseUnit,
      tokensOwed1BaseUnit: snapshot.tokensOwed1BaseUnit,
    };
  }
  if (step.kind === "collect") {
    return {
      ...base,
      liquidity: plan.accounting.remainingLiquidity,
      reserve0BaseUnit: (
        BigInt(snapshot.reserve0BaseUnit) - BigInt(plan.accounting.principal0BaseUnit)
      ).toString(),
      reserve1BaseUnit: (
        BigInt(snapshot.reserve1BaseUnit) - BigInt(plan.accounting.principal1BaseUnit)
      ).toString(),
      tokensOwed0BaseUnit: plan.accounting.collectTotal0BaseUnit,
      tokensOwed1BaseUnit: plan.accounting.collectTotal1BaseUnit,
    };
  }
  return {
    ...base,
    liquidity: "0",
    reserve0BaseUnit: "0",
    reserve1BaseUnit: "0",
    tokensOwed0BaseUnit: "0",
    tokensOwed1BaseUnit: "0",
  };
}

export class PostgresLocalPositionStepPlanAuthorizer
  implements LocalPositionStepPlanAuthorizer
{
  readonly #now: () => Date;
  readonly #registry: LocalPositionExecutionRegistry;

  constructor(
    readonly pool: Pool,
    readonly verifier: LocalPositionPlanChainVerifier,
    input: { now?: () => Date; registry?: LocalPositionExecutionRegistry } = {},
  ) {
    this.#now = input.now ?? (() => new Date());
    this.#registry = validateLocalPositionExecutionRegistry(
      input.registry ?? P05_LOCAL_POSITION_EXECUTION_REGISTRY,
    );
  }

  async authorize(input: Parameters<LocalPositionStepPlanAuthorizer["authorize"]>[0]) {
    try {
      const step = input.plan.steps.find(({ stepId }) => stepId === input.stepId);
      if (
        !step ||
        input.plan.planDigest !== input.planDigest ||
        localPositionExecutionPlanDigest(input.plan) !== input.planDigest ||
        input.plan.deadline <= this.#now().toISOString() ||
        !calldataMatches(input.plan, step)
      ) {
        return false;
      }
      validateLocalPositionExecutionPlan(
        input.plan,
        {
          currentBlockHash: input.plan.snapshot.block.hash,
          currentBlockNumber: input.plan.snapshot.block.number,
          expectedAccounting: structuredClone(input.plan.accounting),
          expectedAction: structuredClone(input.plan.action),
          expectedManager: structuredClone(input.plan.manager),
          expectedSnapshot: structuredClone(input.plan.snapshot),
          expectedSteps: structuredClone(input.plan.steps),
          expectedWallet: structuredClone(input.plan.wallet),
          registryDigest: this.#registry.registryDigest,
        },
        this.#now(),
      );
      const result = await this.pool.query<AuthorizationRow>(
        `SELECT o.state AS operation_state, o.plan_digest, o.plan_payload,
                s.ordinal AS step_ordinal, s.step_kind, s.state AS step_state,
                s.nonce::text AS step_nonce, s.fencing_token::text AS step_fencing_token,
                s.semantic_digest AS step_semantic_digest, s.transaction_to AS step_to,
                s.transaction_data AS step_data, s.transaction_data_digest AS step_data_digest,
                tx.generation AS active_generation,
                tx.max_fee_per_gas_base_unit::text AS active_max_fee,
                tx.max_priority_fee_per_gas_base_unit::text AS active_max_priority,
                r.generation AS replacement_generation, r.state AS replacement_state,
                r.max_fee_per_gas_base_unit::text AS replacement_max_fee,
                r.max_priority_fee_per_gas_base_unit::text AS replacement_max_priority
           FROM local_position_operations o
           JOIN local_position_operation_steps s ON s.operation_id = o.operation_id
           LEFT JOIN local_position_step_transactions tx ON tx.transaction_id = s.active_transaction_id
           LEFT JOIN local_position_replacement_authorizations r
             ON r.step_id = s.step_id AND r.state = 'pending'
          WHERE o.operation_id = $1 AND o.tenant_id = $2 AND o.user_id = $3
            AND s.step_id = $4`,
        [input.plan.operationId, input.tenantId, input.userId, input.stepId],
      );
      const row = result.rows[0];
      if (
        !row ||
        row.operation_state === "failed" ||
        row.operation_state === "succeeded" ||
        row.plan_digest !== input.planDigest ||
        stable(row.plan_payload) !== stable(input.plan) ||
        row.step_ordinal !== step.ordinal ||
        row.step_kind !== step.kind ||
        row.step_nonce !== step.nonce ||
        row.step_fencing_token !== step.fencingToken ||
        row.step_semantic_digest !== step.semanticDigest ||
        row.step_to !== step.transaction.to ||
        row.step_data !== step.transaction.data ||
        row.step_data_digest !== step.transaction.dataDigest ||
        !["queued", "signing", "dropped", "reconciling"].includes(row.step_state)
      ) {
        return false;
      }
      const prior = await this.pool.query<{ canonical_count: string; succeeded_count: string }>(
        `SELECT
           count(*) FILTER (WHERE s.state = 'succeeded')::text AS succeeded_count,
           count(*) FILTER (WHERE EXISTS (
             SELECT 1 FROM local_position_receipt_evidence e
              WHERE e.step_id = s.step_id AND e.canonical = true
                AND e.receipt_status = 'success'
           ))::text AS canonical_count
           FROM local_position_operation_steps s
          WHERE s.operation_id = $1 AND s.ordinal < $2`,
        [input.plan.operationId, step.ordinal],
      );
      if (
        prior.rows[0]?.succeeded_count !== String(step.ordinal) ||
        prior.rows[0]?.canonical_count !== String(step.ordinal)
      ) {
        return false;
      }
      const maxFee = BigInt(input.maxFeePerGasBaseUnit);
      const priority = BigInt(input.maxPriorityFeePerGasBaseUnit);
      if (
        maxFee <= 0n ||
        priority < 0n ||
        priority > maxFee ||
        maxFee > BigInt(step.feeLimit.maxFeePerGasBaseUnit) ||
        priority > BigInt(step.feeLimit.maxPriorityFeePerGasBaseUnit)
      ) {
        return false;
      }
      if (input.generation === 0) {
        if (row.active_generation !== null || row.replacement_generation !== null) return false;
      } else if (
        row.replacement_generation !== input.generation ||
        row.replacement_state !== "pending" ||
        row.replacement_max_fee !== input.maxFeePerGasBaseUnit ||
        row.replacement_max_priority !== input.maxPriorityFeePerGasBaseUnit ||
        row.active_generation !== input.generation - 1
      ) {
        return false;
      }
      const chain = await this.verifier.verifyStep(input.plan, step);
      if (
        chain.canonicalSnapshotBlockHash !== input.plan.snapshot.block.hash ||
        chain.managerCodeHash !== this.#registry.manager.runtimeCodeHash ||
        chain.owner !== input.plan.wallet.address ||
        chain.approvedAddress !== input.plan.snapshot.position.approval.approvedAddress ||
        chain.approvedForAll !== input.plan.snapshot.position.approval.approvedForAll ||
        stable(chain.position) !== stable(expectedPosition(input.plan, step)) ||
        chain.tokenCode.length !== input.plan.snapshot.tokens.length ||
        chain.tokenCode.some(
          (token, index) =>
            token.address !== input.plan.snapshot.tokens[index]!.address ||
            token.runtimeCodeHash !== input.plan.snapshot.tokens[index]!.runtimeCodeHash,
        )
      ) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }
}
