import type { Pool } from "pg";

import type { SwapQuoteSnapshotStore } from "./swap-quotes.js";

export class PostgresSwapQuoteSnapshotStore implements SwapQuoteSnapshotStore {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async append(input: Parameters<SwapQuoteSnapshotStore["append"]>[0]): Promise<void> {
    const { quote } = input;
    await this.#pool.query(
      `INSERT INTO swap_quote_snapshots (
         tenant_id, user_id, wallet_id, wallet_address, chain_id, platform_id,
         token_in, token_out, amount_in_base_unit, amount_out_base_unit,
         min_out_base_unit, slippage_bps, price_impact_bps, router, spender,
         selector, calldata_digest, route_tokens, pool_path, gas_limit,
         gas_price_wei, estimated_fee_wei, provider_snapshot_id, registry_version,
         observed_block_number, max_block_number, quoted_at, expires_at, deadline,
         digest_domain, digest_version, digest, execution_enabled
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9::numeric, $10::numeric,
         $11::numeric, $12, $13, $14, $15, $16, $17, $18::jsonb, $19::jsonb,
         $20::numeric, $21::numeric, $22::numeric, $23, $24, $25::numeric,
         $26::numeric, $27, $28, $29, $30, $31, $32, $33
       ) ON CONFLICT (tenant_id, user_id, digest) DO NOTHING`,
      [
        input.tenantId,
        input.userId,
        quote.walletId,
        quote.walletAddress,
        quote.chainId,
        quote.platformId,
        quote.tokenIn,
        quote.tokenOut,
        quote.amountInBaseUnit,
        quote.amountOutBaseUnit,
        quote.minOutBaseUnit,
        quote.slippageBps,
        quote.priceImpactBps,
        quote.router,
        quote.spender,
        quote.selector,
        quote.calldataDigest,
        JSON.stringify(quote.route.tokens),
        JSON.stringify(quote.route.poolPath),
        quote.gas.gasLimit,
        quote.gas.gasPriceWei,
        quote.gas.estimatedFeeWei,
        quote.providerSnapshotId,
        quote.registryVersion,
        quote.blockNumber,
        quote.maxBlockNumber,
        quote.quotedAt,
        quote.expiresAt,
        quote.deadline,
        quote.digestDomain,
        quote.digestVersion,
        quote.digest,
        quote.executionEnabled,
      ],
    );
  }
}
