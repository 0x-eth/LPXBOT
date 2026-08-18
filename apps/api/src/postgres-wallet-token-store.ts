import type { EvmAddress } from "@lpbot/api-contract";
import type { Pool } from "pg";

import type {
  StoredWalletToken,
  WalletTokenInsertResult,
  WalletTokenStore,
} from "./wallet-assets.js";

interface TokenRow {
  chain_id: string;
  created_at: Date;
  token_address: EvmAddress;
  token_decimals: number;
  token_name: string;
  token_symbol: string;
}

function stored(row: TokenRow): StoredWalletToken {
  return {
    chainId: Number(row.chain_id),
    createdAt: row.created_at,
    decimals: row.token_decimals,
    default: false,
    name: row.token_name,
    symbol: row.token_symbol,
    tokenAddress: row.token_address,
  };
}

function equal(left: StoredWalletToken, right: StoredWalletToken): boolean {
  return (
    left.chainId === right.chainId &&
    left.decimals === right.decimals &&
    left.name === right.name &&
    left.symbol === right.symbol &&
    left.tokenAddress === right.tokenAddress
  );
}

export class PostgresWalletTokenStore implements WalletTokenStore {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async delete(input: {
    chainId: number;
    tokenAddress: EvmAddress;
    userId: string;
    walletId: string;
  }): Promise<boolean> {
    const result = await this.#pool.query(
      `DELETE FROM custody_wallet_custom_tokens
        WHERE user_id = $1 AND wallet_id = $2 AND chain_id = $3 AND token_address = $4`,
      [input.userId, input.walletId, input.chainId, input.tokenAddress],
    );
    return result.rowCount === 1;
  }

  async insert(
    input: StoredWalletToken & { userId: string; walletId: string },
  ): Promise<WalletTokenInsertResult> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const inserted = await client.query<TokenRow>(
        `INSERT INTO custody_wallet_custom_tokens (
           user_id, wallet_id, chain_id, token_address,
           token_name, token_symbol, token_decimals, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (user_id, wallet_id, chain_id, token_address) DO NOTHING
         RETURNING chain_id::text, token_address, token_name, token_symbol, token_decimals, created_at`,
        [
          input.userId,
          input.walletId,
          input.chainId,
          input.tokenAddress,
          input.name,
          input.symbol,
          input.decimals,
          input.createdAt,
        ],
      );
      if (inserted.rows[0]) {
        await client.query("COMMIT");
        return { status: "created", value: stored(inserted.rows[0]) };
      }
      const existing = await client.query<TokenRow>(
        `SELECT chain_id::text, token_address, token_name, token_symbol, token_decimals, created_at
           FROM custody_wallet_custom_tokens
          WHERE user_id = $1 AND wallet_id = $2 AND chain_id = $3 AND token_address = $4
          FOR UPDATE`,
        [input.userId, input.walletId, input.chainId, input.tokenAddress],
      );
      const value = existing.rows[0] ? stored(existing.rows[0]) : null;
      if (!value) throw new Error("Custom token conflict row disappeared");
      await client.query("COMMIT");
      return { status: equal(value, input) ? "duplicate" : "metadata-conflict", value };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async list(input: {
    chainId: number;
    userId: string;
    walletId: string;
  }): Promise<StoredWalletToken[]> {
    const result = await this.#pool.query<TokenRow>(
      `SELECT chain_id::text, token_address, token_name, token_symbol, token_decimals, created_at
         FROM custody_wallet_custom_tokens
        WHERE user_id = $1 AND wallet_id = $2 AND chain_id = $3
        ORDER BY created_at, token_address`,
      [input.userId, input.walletId, input.chainId],
    );
    return result.rows.map(stored);
  }
}
