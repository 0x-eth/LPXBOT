import { LocalEvmRpcClient, type LocalEvmRpcClientOptions } from "@lpbot/chain-adapters";
import {
  buildWalletHelperV1DeploymentMaterial,
  helperDeploymentComponent,
  P05_HELPER_DEPLOYMENT_REGISTRY,
  validateHelperDeploymentRegistry,
  type HelperDeploymentRegistry,
} from "@lpbot/chain-registry";
import {
  helperDeploymentPlanDigest,
  validateHelperDeploymentPlan,
  type HelperDeploymentPlan,
  type HelperDeploymentPlanValidationContext,
} from "@lpbot/domain/helper-deployment";
import type { Pool } from "pg";
import { getContractAddress, keccak256, type Hex } from "viem";

import type { HelperDeploymentPlanAuthorizer } from "./custody-types.js";

interface AuthorizationRow {
  authorized: boolean;
}

export interface HelperDeploymentPlanChainVerification {
  blockNumber: string;
  componentCode: ReadonlyArray<{
    address: `0x${string}`;
    role: "adapter" | "permit2";
    runtimeCodeHash: `0x${string}` | null;
  }>;
  expectedAddressCode: Hex;
  expectedRuntimeCodeHash: `0x${string}`;
  tokenCode: ReadonlyArray<{
    address: `0x${string}`;
    runtimeCodeHash: `0x${string}` | null;
  }>;
}

export interface HelperDeploymentPlanChainVerifier {
  verify(plan: HelperDeploymentPlan): Promise<HelperDeploymentPlanChainVerification>;
}

export interface ViemLocalHelperDeploymentPlanVerifierOptions {
  chainId: 31_337;
  fetch?: typeof fetch;
  provider: Pick<LocalEvmRpcClientOptions, "providerId" | "rpcUrl">;
  registry?: HelperDeploymentRegistry;
  timeoutMilliseconds?: number;
}

function quantity(value: unknown): bigint {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/iu.test(value)) {
    throw new Error("LOCAL_HELPER_SIGNER_QUANTITY_INVALID");
  }
  return BigInt(value);
}

function bytecode(value: unknown): Hex {
  if (typeof value !== "string" || !/^0x(?:[0-9a-f]{2})*$/iu.test(value)) {
    throw new Error("LOCAL_HELPER_SIGNER_CODE_INVALID");
  }
  return value.toLowerCase() as Hex;
}

function codeHash(value: Hex): `0x${string}` | null {
  return value === "0x" ? null : keccak256(value);
}

function validationContext(
  plan: HelperDeploymentPlan,
  registry: HelperDeploymentRegistry,
): HelperDeploymentPlanValidationContext {
  const material = buildWalletHelperV1DeploymentMaterial(plan.wallet.address, registry);
  return {
    adapter: helperDeploymentComponent("adapter", registry).address,
    chainId: 31_337,
    constructorArgumentsHash: material.constructorArgumentsHash,
    creationCodeHash: registry.helperTemplate.creationCodeHash,
    expectedAddress: getContractAddress({
      from: plan.wallet.address,
      nonce: BigInt(plan.nonce),
    }).toLowerCase() as `0x${string}`,
    expectedRuntimeCodeHash: plan.deployment.expectedRuntimeCodeHash,
    helperVersion: "WalletHelperV1",
    initCode: material.initCode,
    initCodeHash: material.initCodeHash,
    owner: plan.wallet.address,
    permit2: helperDeploymentComponent("permit2", registry).address,
    registryDigest: registry.registryDigest,
    registryRollbackVersion: registry.rollbackVersion,
    registryValidFromBlock: registry.validFromBlock,
    registryValidToBlock: registry.validToBlock,
    registryVersion: registry.registryVersion,
    tokenA: registry.tokens[0],
    tokenB: registry.tokens[1],
  };
}

export class ViemLocalHelperDeploymentPlanVerifier
  implements HelperDeploymentPlanChainVerifier
{
  readonly #client: LocalEvmRpcClient;
  readonly #registry: HelperDeploymentRegistry;

  constructor(options: ViemLocalHelperDeploymentPlanVerifierOptions) {
    if (options.chainId !== 31_337) throw new RangeError("LOCAL_HELPER_SIGNER_CHAIN_INVALID");
    this.#registry = validateHelperDeploymentRegistry(
      options.registry ?? P05_HELPER_DEPLOYMENT_REGISTRY,
    );
    this.#client = new LocalEvmRpcClient({
      expectedChainId: 31_337,
      ...(options.fetch ? { fetch: options.fetch } : {}),
      ...options.provider,
      ...(options.timeoutMilliseconds
        ? { timeoutMilliseconds: options.timeoutMilliseconds }
        : {}),
    });
  }

  async verify(plan: HelperDeploymentPlan): Promise<HelperDeploymentPlanChainVerification> {
    const [blockNumber, expectedAddressCode, simulatedRuntime, componentCodes, tokenCodes] =
      await Promise.all([
        this.#client.request<Hex>("eth_blockNumber", []),
        this.#client.request<Hex>("eth_getCode", [plan.deployment.expectedAddress, "latest"]),
        this.#client.request<Hex>("eth_call", [
          { data: plan.transaction.data, from: plan.wallet.address, value: "0x0" },
          "latest",
        ]),
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
    const runtime = bytecode(simulatedRuntime);
    if (runtime === "0x") throw new Error("LOCAL_HELPER_SIGNER_RUNTIME_EMPTY");
    return {
      blockNumber: quantity(blockNumber).toString(),
      componentCode: this.#registry.components.map(({ address, role }, index) => ({
        address,
        role,
        runtimeCodeHash: codeHash(bytecode(componentCodes[index])),
      })),
      expectedAddressCode: bytecode(expectedAddressCode),
      expectedRuntimeCodeHash: keccak256(runtime),
      tokenCode: this.#registry.tokens.map(({ address }, index) => ({
        address,
        runtimeCodeHash: codeHash(bytecode(tokenCodes[index])),
      })),
    };
  }
}

export class PostgresHelperDeploymentPlanAuthorizer
  implements HelperDeploymentPlanAuthorizer
{
  readonly #chain: HelperDeploymentPlanChainVerifier;
  readonly #now: () => Date;
  readonly #pool: Pool;
  readonly #registry: HelperDeploymentRegistry;

  constructor(input: {
    chain: HelperDeploymentPlanChainVerifier;
    now?: () => Date;
    pool: Pool;
    registry?: HelperDeploymentRegistry;
  }) {
    this.#chain = input.chain;
    this.#now = input.now ?? (() => new Date());
    this.#pool = input.pool;
    this.#registry = validateHelperDeploymentRegistry(
      input.registry ?? P05_HELPER_DEPLOYMENT_REGISTRY,
    );
  }

  async authorize(input: {
    plan: HelperDeploymentPlan;
    planDigest: `sha256:${string}`;
    tenantId: string;
    userId: string;
  }): Promise<boolean> {
    const plan = input.plan;
    try {
      validateHelperDeploymentPlan(plan, validationContext(plan, this.#registry), this.#now());
    } catch {
      return false;
    }
    if (helperDeploymentPlanDigest(plan) !== input.planDigest || plan.planDigest !== input.planDigest) {
      return false;
    }
    const result = await this.#pool.query<AuthorizationRow>(
      `SELECT true AS authorized
         FROM chain_operations o
         JOIN custody_wallets w
           ON w.wallet_id = o.wallet_id AND w.user_id = o.user_id
          AND w.tenant_id = o.tenant_id
         JOIN wallet_nonce_ledgers l
           ON l.chain_id = o.chain_id AND l.wallet_id = o.wallet_id
         JOIN wallet_helper_deployment_bindings b
           ON b.operation_id = o.operation_id
        WHERE o.operation_id = $1
          AND o.tenant_id = $2
          AND o.user_id = $3
          AND o.wallet_id = $4
          AND o.wallet_address = $5
          AND o.chain_id = 31337
          AND o.operation_kind = 'helper-deployment'
          AND o.helper_version = 'WalletHelperV1'
          AND o.registry_version = $6
          AND o.registry_digest = $7
          AND o.registry_block_number = $8
          AND o.expected_address = $9
          AND o.expected_runtime_code_hash = $10
          AND o.creation_code_hash = $11
          AND o.constructor_arguments_hash = $12
          AND o.adapter_address = $13
          AND o.permit2_address = $14
          AND o.nonce = $15
          AND o.fencing_token = $16
          AND l.fencing_token >= o.fencing_token
          AND l.reconciliation_reason IS NULL
          AND o.transaction_to IS NULL
          AND o.transaction_value_base_unit = 0
          AND o.transaction_data = $17
          AND o.transaction_data_hash = $18
          AND o.snapshot_digest = $19
          AND o.plan_deadline = $20
          AND o.plan_deadline > clock_timestamp()
          AND w.address_lower = $5
          AND w.lifecycle_status = 'active'
          AND w.lock_status = 'ready'
          AND b.state = 'deploying'
          AND b.helper_address = $9
          AND b.owner_address = $5
          AND b.adapter_address = $13
          AND b.permit2_address = $14
          AND b.runtime_code_hash = $10
          AND (
            (
              o.state = 'queued'
              AND o.plan_digest = $21
              AND o.gas_limit = $22
              AND o.max_fee_per_gas_base_unit = $23
              AND o.max_priority_fee_per_gas_base_unit = $24
              AND o.fee_cap_base_unit = $25
              AND NOT EXISTS (
                SELECT 1 FROM chain_operation_transactions t
                 WHERE t.operation_id = o.operation_id AND t.active
              )
            )
            OR
            (
              o.state IN ('broadcast', 'pending', 'dropped')
              AND EXISTS (
                SELECT 1
                  FROM chain_operation_transactions t
                  JOIN chain_operation_replacement_authorizations r
                    ON r.operation_id = o.operation_id
                   AND r.replaced_transaction_id = t.transaction_id
                   AND r.generation = t.generation + 1
                 WHERE t.operation_id = o.operation_id
                   AND t.active
                   AND r.state = 'pending'
                   AND r.expires_at > clock_timestamp()
                   AND r.plan_digest = $21
                   AND r.gas_limit = $22
                   AND r.max_fee_per_gas_base_unit = $23
                   AND r.max_priority_fee_per_gas_base_unit = $24
                   AND r.fee_cap_base_unit = $25
                   AND r.max_fee_per_gas_base_unit >= t.max_fee_per_gas_base_unit
                   AND r.max_priority_fee_per_gas_base_unit >=
                       t.max_priority_fee_per_gas_base_unit
                   AND (
                     r.max_fee_per_gas_base_unit > t.max_fee_per_gas_base_unit
                     OR r.max_priority_fee_per_gas_base_unit >
                        t.max_priority_fee_per_gas_base_unit
                   )
              )
            )
          )`,
      [
        plan.operationId,
        input.tenantId,
        input.userId,
        plan.wallet.walletId,
        plan.wallet.address,
        plan.registry.version,
        plan.registry.digest,
        plan.registry.blockNumber,
        plan.deployment.expectedAddress,
        plan.deployment.expectedRuntimeCodeHash,
        plan.deployment.creationCodeHash,
        plan.deployment.constructorArgumentsHash,
        plan.deployment.adapter,
        plan.deployment.permit2,
        plan.nonce,
        plan.fencingToken,
        plan.transaction.data,
        plan.transaction.dataHash,
        plan.snapshotDigest,
        plan.deadline,
        input.planDigest,
        plan.feeLimit.gasLimit,
        plan.feeLimit.maxFeePerGasBaseUnit,
        plan.feeLimit.maxPriorityFeePerGasBaseUnit,
        plan.feeLimit.feeCapBaseUnit,
      ],
    );
    if (result.rows[0]?.authorized !== true) return false;
    try {
      const verification = await this.#chain.verify(plan);
      if (
        verification.expectedAddressCode !== "0x" ||
        verification.expectedRuntimeCodeHash !== plan.deployment.expectedRuntimeCodeHash ||
        BigInt(verification.blockNumber) < BigInt(this.#registry.validFromBlock) ||
        BigInt(verification.blockNumber) > BigInt(this.#registry.validToBlock)
      ) {
        return false;
      }
      for (const expected of this.#registry.components) {
        const actual = verification.componentCode.find(({ role }) => role === expected.role);
        if (
          !actual ||
          actual.address !== expected.address ||
          actual.runtimeCodeHash !== expected.runtimeCodeHash
        ) {
          return false;
        }
      }
      for (const expected of this.#registry.tokens) {
        const actual = verification.tokenCode.find(({ address }) => address === expected.address);
        if (!actual || actual.runtimeCodeHash !== expected.runtimeCodeHash) return false;
      }
      return true;
    } catch {
      return false;
    }
  }
}
