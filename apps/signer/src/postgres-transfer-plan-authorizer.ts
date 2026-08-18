import {
  validateWalletTransferPlan,
  walletTransferPlanDigest,
  type WalletTransferPlan,
} from "@lpbot/domain/wallet-transfer";
import type { Pool } from "pg";

import type { WalletTransferPlanAuthorizer } from "./custody-types.js";

interface AuthorizationRow {
  authorized: boolean;
}

export class PostgresWalletTransferPlanAuthorizer implements WalletTransferPlanAuthorizer {
  readonly #localChainIds: ReadonlySet<number>;
  readonly #pool: Pool;

  constructor(input: { localChainIds: readonly number[]; pool: Pool }) {
    if (
      input.localChainIds.length < 1 ||
      input.localChainIds.some((chainId) => !Number.isSafeInteger(chainId) || chainId < 1)
    ) {
      throw new RangeError("localChainIds must contain positive chain identifiers");
    }
    this.#localChainIds = new Set(input.localChainIds);
    this.#pool = input.pool;
  }

  async authorize(input: {
    plan: WalletTransferPlan;
    planDigest: `sha256:${string}`;
    tenantId: string;
    userId: string;
  }): Promise<boolean> {
    try {
      validateWalletTransferPlan(input.plan);
    } catch {
      return false;
    }
    if (
      !this.#localChainIds.has(input.plan.chainId) ||
      walletTransferPlanDigest(input.plan) !== input.planDigest
    ) {
      return false;
    }
    const tokenAddress =
      input.plan.asset.kind === "erc20" ? input.plan.asset.tokenAddress : null;
    const result = await this.#pool.query<AuthorizationRow>(
      `SELECT true AS authorized
         FROM wallet_transfer_operations o
         JOIN custody_wallets w
           ON w.wallet_id = o.wallet_id AND w.user_id = o.user_id
         JOIN wallet_nonce_ledgers l
           ON l.chain_id = o.chain_id AND l.wallet_id = o.wallet_id
        WHERE o.operation_id = $1
          AND o.user_id = $2
          AND w.tenant_id = $3
          AND w.lifecycle_status = 'active'
          AND w.lock_status = 'ready'
          AND o.state = 'queued'
          AND o.wallet_id = $4
          AND o.wallet_address = $5
          AND o.chain_id = $6
          AND o.nonce = $7
          AND o.fencing_token = $8
          AND l.fencing_token >= o.fencing_token
          AND l.reconciliation_reason IS NULL
          AND o.asset_kind = $9
          AND o.token_address IS NOT DISTINCT FROM $10
          AND o.recipient = $11
          AND o.amount_base_unit = $12
          AND o.transaction_target = $13
          AND o.transaction_value_base_unit = $14
          AND o.transaction_data = $15
          AND o.gas_limit = $16
          AND o.max_fee_per_gas_base_unit = $17
          AND o.max_priority_fee_per_gas_base_unit = $18
          AND o.fee_cap_base_unit = $19
          AND o.plan_deadline = $20
          AND o.plan_deadline > clock_timestamp()
          AND o.policy_digest = $21
          AND o.plan_digest = $22
          AND (o.address_classification <> 'new-external' OR o.security_password_version IS NOT NULL)
          AND NOT EXISTS (
            SELECT 1
              FROM wallet_transfer_transactions t
             WHERE t.operation_id = o.operation_id AND t.active
          )`,
      [
        input.plan.operationId,
        input.userId,
        input.tenantId,
        input.plan.walletId,
        input.plan.walletAddress,
        input.plan.chainId,
        input.plan.nonce,
        input.plan.fencingToken,
        input.plan.asset.kind,
        tokenAddress,
        input.plan.recipient,
        input.plan.amountBaseUnit,
        input.plan.transactionTarget,
        input.plan.transactionValueBaseUnit,
        input.plan.transactionData,
        input.plan.feeLimit.gasLimit,
        input.plan.feeLimit.maxFeePerGasBaseUnit,
        input.plan.feeLimit.maxPriorityFeePerGasBaseUnit,
        input.plan.feeLimit.feeCapBaseUnit,
        input.plan.deadline,
        input.plan.policyDigest,
        input.planDigest,
      ],
    );
    return result.rows[0]?.authorized === true;
  }
}

